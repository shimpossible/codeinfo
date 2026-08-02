import * as vscode from 'vscode';
import { Scope, Service } from '../service';
import * as cvg from './coverage';
import { setUncaughtExceptionCaptureCallback } from 'process';

export class CodeLensProvider implements vscode.CodeLensProvider {

    private _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;
    private coverage: cvg.Coverage;
    private output: vscode.LogOutputChannel;

    constructor(coverage: cvg.Coverage, output: vscode.LogOutputChannel) {
        this.coverage = coverage;
        this.output = output;
    }

    public notifyUpdated() {

        this.output.info("Notify codelens change");
        this._onDidChangeCodeLenses.fire();
    };

    public provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.ProviderResult<vscode.CodeLens[]> {

        const uri = document.uri;
        const scopes = this.coverage.getScopes(uri);
        const codelens: vscode.CodeLens[] = [];

        // lineno vs scopes at lineno
        const lines =new Map<number, number>();

        scopes.forEach( (scope) => {

            const count = lines.get(scope.line) || 0;
            lines.set(scope.line, count+1);
        });

        
        scopes.forEach( (scope) => {

            // ignore single scopes
            if (lines.get(scope.line) === 1) { return; }

            // prevent a 2nd CodeLens at this line by setting it to 1
            lines.set(scope.line,1);

            const range = document.lineAt(scope.line).range;
            codelens.push( new vscode.CodeLens(range, {
                title: 'CodeInfo: Toggle Scope',
                command: "codeinfo.coverage.disableScope",
                arguments: [uri, scope.name, scope.line]
            }));
        });

        return codelens;
        
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

    public async updateCoverageInfo() {
    }

};