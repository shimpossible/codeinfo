import * as vscode from 'vscode';
import { Scope, Service } from '../service';
import * as cvg from './coverage';

export class CodeLensProvider implements vscode.CodeLensProvider {

    private codeLenses: vscode.CodeLens[] = [];
    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    private coverageData: Map<string, cvg.FileCoverage[]> = new Map<string, cvg.FileCoverage[]>();
    private service: Service;
    private output: vscode.LogOutputChannel;

    constructor(service: Service, output: vscode.LogOutputChannel) {
        this.service = service;
        this.output = output;
    }

    public notifyUpdated() {

        this.output.info("Notify codelens change");
        this._onDidChangeCodeLenses.fire();
    };

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {
        this.codeLenses = [];

        const uri = document.uri;
        const fileCovAll = this.coverageData.get(uri.toString());
        if (!fileCovAll) {
            return [];
        }

        const scopes = new Map<string, number>(); // earlist line number for a given scope
        this.output.info("Updating code lens for " + uri.toString());
        // find all scopes
        fileCovAll.forEach((fc) => {
            fc.coverage.forEach((curr) => {
                if (curr.scope) {

                    const line = scopes.get(curr.scope) || curr.location;
                    scopes.set(curr.scope, Math.min(line, curr.location));
                }
            });
        });

        scopes.forEach((line, scopeName) => {

            const range = document.lineAt(line).range;

            const scope = new Scope({
                name: scopeName,
                line: line,
                uri: uri,
            });
            const title = this.service.isScopeEnabled(scope)
                ? `Disable ${scopeName}`
                : `Enable ${scopeName}`;

            this.codeLenses.push(
                new vscode.CodeLens(range, {
                    title: title,
                    command: "codeinfo.coverage.disableScope",
                    arguments: [uri, scopeName, line]
                })
            );
        });

        return this.codeLenses;
    };

    /**
     * This is used to set "command" on a codelens, as that is expected to take some time.
     * @param codeLens 
     * @param token 
     * @returns 
     */
    public resolveCodeLens?(codeLens: vscode.CodeLens, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens> {
        this.output.info("Resolve code lens");
        return codeLens;
    }

    public async updateCoverageInfo(data: Map<string, cvg.FileCoverage[]>) {
        this.coverageData = data;
    }

};