import { Config, IDataFile, resolveUri } from "./config";
import {
    Disposable,
    FileSystemWatcher,
    LogOutputChannel,
    Uri, Range,
    Diagnostic,
    MarkdownString,
    window,
    workspace,
    languages,
    TreeItemCheckboxState,
    QuickPickItem,
    QuickPickOptions,
} from "vscode";

import * as cvg from './coverage/coverage';
import * as codelens from './coverage/codelens';
import { SimpleCoverageParser } from './coverage/simple';
import { SimpleDiagnosticParser } from './diag/simple';
import { memoryUsage } from "process";
import { urlToHttpOptions } from "url";
import { match } from "assert";


export class Scope {
    name: string;
    line: number;
    uri: Uri;

    constructor(obj: { name: string, line: number, uri: Uri }) {
        this.name = obj.name;
        this.line = obj.line;
        this.uri = obj.uri;
    }

    public toString(): string {

        // scopes dont match by line number,
        // as the name should be unique to file
        return `${this.uri}:${this.name}`;
    }
};


export interface IDiagParser {
    /**
     * Parse a file for Diagnostic data
     * @param path path to diagnostic file
     */
    parse(path: IDataFile): Promise<ReadonlyArray<[Uri, readonly Diagnostic[] | undefined]>>;
};




class ScopedLine {
    line: number;
    scope: string | undefined;
    constructor(obj: { line: number, scope: string | undefined }) {
        this.line = obj.line;
        this.scope = obj.scope;
    }
    public toString(): string {
        return `${this.scope}:${this.line}`;
    }
};

/**
 * Merge two coverage lists
 * @param oldCoverage  Existing coverage
 * @param newCoverage  new coverage
 * @param matcher      how to match two FileCoverage objects
 * @returns  old and new coverage numbers merged
 */
function mergeCoverageData(
    oldCoverage: cvg.FileCoverage | undefined,
    newCoverage: cvg.FileCoverage,
    matcher: (value: cvg.StatementCoverage) => boolean,
    log: LogOutputChannel
): cvg.FileCoverage {

    //sort lines for lineno and scope
    const coverage = new Map<number, cvg.StatementCoverage>();

    oldCoverage?.coverage.forEach((cov: cvg.StatementCoverage) => {

        const key = cov.location;
        const existing = coverage.get(key);
        if (existing) {
            coverage.set(key, new cvg.StatementCoverage({
                executed: existing.executed + cov.executed, // merge the exec count
                location: existing.location,
                // merge the two branch exec counts
                branches: existing.branches?.map((val, idx) => {
                    const exec_count = cov.branches?.[idx].executed || 0;
                    return new cvg.BranchCoverage(val.executed + exec_count);
                })
            }));
        } else {
            coverage.set(key, cov); // no existing, use the item
        }
    });

    newCoverage.coverage.forEach((cov: cvg.StatementCoverage) => {

        // ignore this?
        if (!matcher(cov)) { return; }

        const key = cov.location;
        const existing = coverage.get(key);
        if (existing) {

            // merge the two branch exec counts
            const mergedBranches = existing.branches?.map((val, idx) => {
                const exec_count = cov.branches?.[idx]?.executed || 0;
                return new cvg.BranchCoverage(val.executed + exec_count);
            });

            // if existing had less branches than add remaining new branches
            const start = existing.branches?.length || 0;
            mergedBranches?.push(...cov.branches?.slice(start) || []);

            const merged = new cvg.StatementCoverage({
                executed: existing.executed + cov.executed, // merge the exec count
                location: existing.location,
                branches: mergedBranches,
            });

            /*
            Override the "kind" field as there is no easy way to compute it based on the merged results.
            Instead we use the kind from the two sides

                the merged kind follows thie table
                | old    |   new   | merged
                | full   |   full  | full
                | full   |    part  | part
                | full   |   none  | part
                | part   |   part  | part
                | part   |   none  | part
                | part   |   full  | part
            */
            merged.kind = cov.kind;
            if (existing !== undefined) {
                {
                    merged.kind = cvg.StatementCoverageKind.partial;

                    // only full is both full
                    if (existing.kind === cvg.StatementCoverageKind.full && cov.kind === cvg.StatementCoverageKind.full) {
                        merged.kind = cvg.StatementCoverageKind.full;
                    }

                    // only none if both none
                    if (existing.kind === cvg.StatementCoverageKind.none && cov.kind === cvg.StatementCoverageKind.none) {
                        merged.kind = cvg.StatementCoverageKind.none;
                    }
                }
            }
            coverage.set(key, merged);
        } else {
            coverage.set(key, cov); // no existing, use the item
        }
    });

    const result = new cvg.FileCoverage(
        newCoverage.uri as Uri,
        Array.from(coverage.values()));
    return result;
}

export class Service {

    private config: Config;
    private outputChannel: LogOutputChannel;
    private coverageWatcher: FileSystemWatcher | undefined;
    private editorWatcher: Disposable | undefined;


    private diagnostics = languages.createDiagnosticCollection("coverage");

    private diagParsers = new Map<string, IDiagParser>();
    private simple: SimpleDiagnosticParser;
    private simpleCov: SimpleCoverageParser;

    private lens: codelens.CodeLensProvider;

    private coverage: cvg.Coverage;

    private disposables: Disposable[] = [];

    constructor(config: Config,
        outputChannel: LogOutputChannel,
    ) {
        this.config = config;
        this.outputChannel = outputChannel;
        this.coverage = new cvg.Coverage(outputChannel, config);
        this.lens = new codelens.CodeLensProvider(this.coverage, this.outputChannel);
        this.simple = new SimpleDiagnosticParser(outputChannel);


        // type mappings for diagnostic files
        this.diagParsers.set("simple", this.simple);

        this.simpleCov = new SimpleCoverageParser();

        this.disposables.push(languages.registerCodeLensProvider("*", this.lens));

    }

    public dispose() {
        this.coverage.dispose();
        this.outputChannel.debug("Disposing Servicatie");
        this.coverageWatcher?.dispose();
        this.editorWatcher?.dispose();
        this.disposables.forEach((x) => { x.dispose; });

    }


    /// Watch workspace(s) for new data files?
    public async watchWorkspace() {

        // stop watching?
        if (this.coverageWatcher) {
            this.coverageWatcher.dispose();
        }

        // initial process
        this.processCoverageData();
        this.processDiagnosicData();

    }


    /**
     * process coverage information and update rednered
     * coverage
     */
    public async processCoverageData() {

        this.outputChannel.trace(`UPDATE COVERAGE DATA`);
        this.coverage.updateCoverageData();

        this.lens.updateCoverageInfo();

    }

    public async disableScope(uri: Uri, name: string, line: number) {

        // scopes at line
        const scopes = this.coverage.getScopes(uri);

        const items: { 'label': string, 'picked': boolean, 'scope': Scope }[] = [];
        await Promise.all(scopes.map(async (x) => {

            // not a scope on this line
            if (x.line !== line) { return; }

            items.push({
                'label': x.name,
                'picked': this.coverage.isScopeEnabled(x),
                'scope': x,
            });
        }));

        const results = await window.showQuickPick(items, {
            canPickMany: true
        });

        // undefined means they clicked off.
        // empty [] means they unselected everything
        if (results) {
            // map back into items, to uncheck any not selected
            items.forEach((x) => {
                const has = results?.find((y) => { return x.scope === y.scope; });
                if (!has) {
                    x.picked = false;
                } else {
                    x.picked = true;
                }
            });

            await this.coverage.toggleScopes(items);
        }
    }

    public async processDiagnosicData() {
        this.outputChannel.info("Updating Diagnostic data");

        this.diagnostics.clear();

        await this.config.diagFiles.forEach(async (file) => {
            try {
                this.processDiagnosicFile(file);
            } catch (e) {
                this.outputChannel.error(e as Error);
            }
        });
        this.outputChannel.info("Finished Diagnostic data");

    }

    /**
     * Process a single Diagnostic file
     * @param file diagnostic file to process
     */
    private async processDiagnosicFile(file: IDataFile) {
        this.outputChannel.trace(`Parse ${file.path}`);

        // find parser based on type
        // default to simple
        const parser = this.diagParsers.get(file.type) || this.simple;
        const map = await parser.parse(file);
        this.diagnostics.set(map);

        this.outputChannel.trace(`Parse ${file.path} Finished`);
    }
}