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
} from "vscode";


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

export interface ICoverageParser {
    /**
     * Parse a file for Coverage data
     * @param path path to coverage file
     */
    parse(path: IDataFile): Promise<ReadonlyArray<FileCoverage>>;
};


export class BranchCoverage {
    executed: number;
    /**
         * @param executed The number of times this branch was executed, or a
         * boolean indicating  whether it was executed if the exact count is
         * unknown. If zero or false, the branch will be marked as un-covered.
         */
    constructor(executed: number) {
        this.executed = executed;
    }
};

enum StatementCoverageKind {
    none = "none",
    full = "full",
    partial = "partial",
};

/**
 * Custom Time because code coverage wasn't until a later version of VsCode
 */
export class StatementCoverage {

    /** 
     * Times line was executed
     */
    executed: number;

    /**
     * line number
     */
    location: number;

    /**
     * Method / Function name
     */
    scope: string | undefined;

    /**
     * Branch coverage for line
     */
    branches: BranchCoverage[] | undefined;

    /**
     * determines how much coverage this line has gotten
     */
    kind: StatementCoverageKind;

    /**
     * @param location The statement position/line.
     * @param executed The number of times this statement was executed,
     *  If zero, the statement will be marked as un-covered.
     * @param branches Coverage from branches of this line.  If it's not a
     * conditional, this should be omitted.
     */
    constructor(opt: {
        executed: number,
        location: number,
        branches: BranchCoverage[] | undefined,
        scope?: string | undefined
    }) {

        this.executed = opt.executed;
        this.location = opt.location;
        this.branches = opt.branches;
        this.scope = opt.scope;

        if (opt.branches?.length) {
            // branches on this line, so must execute all of them to get FULL
            const min_executed = opt.branches?.reduce((last, b) => {
                return last.executed < b.executed
                    ? last
                    : b;
            }).executed;

            const num_executed = opt.branches?.reduce((sum, b) => {
                return sum + b.executed;
            }, 0);

            if (min_executed > 0) { // each branch at least once?
                this.kind = StatementCoverageKind.full;
            } else if (num_executed === 0) {
                this.kind = StatementCoverageKind.none;
            } else { // at least one not executed
                this.kind = StatementCoverageKind.partial;
            }
        } else {
            // normal statement with no branches, so any execution is full
            if (this.executed) {
                this.kind = StatementCoverageKind.full;
            }
            else {
                // execution count is 0, so no coverage
                this.kind = StatementCoverageKind.none;
            }
        }
    }
};

export class FileCoverage {
    uri: Uri | string;
    coverage: StatementCoverage[];

    /**
     * @param uri Covered file URI
     * @param statementCoverage Statement coverage information. If the reporter
     * does not provide statement coverage information, this can instead be
     * used to represent line coverage.
     */
    constructor(uri: Uri, coverage: StatementCoverage[]) {
        this.uri = uri;
        this.coverage = coverage;
    }
};

export interface SortedFileCoverage {
    uri: Uri;
    full: number[];
    partial: number[];
    none: number[];
}

/**
 * Covert a FileCoverage into groups of full, partial and none lines
 * @param coverage FileCoverage
 */
export function sortCoverage(coverage: FileCoverage): SortedFileCoverage {

    const ret: SortedFileCoverage = {
        uri: coverage.uri as Uri,
        full: [],
        partial: [],
        none: []
    };

    // group by kind
    coverage.coverage.map((cov) => {
        if (cov.kind === StatementCoverageKind.full) {
            ret.full.push(cov.location);
        } else if (cov.kind === StatementCoverageKind.partial) {
            ret.partial.push(cov.location);
        } else if (cov.kind === StatementCoverageKind.none) {
            ret.none.push(cov.location);
        }
    });

    return ret;
}

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
    oldCoverage: FileCoverage | undefined,
    newCoverage: FileCoverage,
    matcher: (value: StatementCoverage) => boolean,
    log: LogOutputChannel
): FileCoverage {

    //sort lines for lineno and scope
    const coverage = new Map<number, StatementCoverage>();

    oldCoverage?.coverage.forEach((cov: StatementCoverage) => {

        const key = cov.location;
        const existing = coverage.get(key);
        if (existing) {
            coverage.set(key, new StatementCoverage({
                executed: existing.executed + cov.executed, // merge the exec count
                location: existing.location,
                // merge the two branch exec counts
                branches: existing.branches?.map((val, idx) => {
                    const exec_count = cov.branches?.[idx].executed || 0;
                    return new BranchCoverage(val.executed + exec_count);
                })
            }));
        } else {
            coverage.set(key, cov); // no existing, use the item
        }
    });

    newCoverage.coverage.forEach((cov: StatementCoverage) => {

        // ignore this?
        if (!matcher(cov)) { return; }

        const key = cov.location;
        const existing = coverage.get(key);
        if (existing) {


            // merge the two branch exec counts
            const mergedBranches = existing.branches?.map((val, idx) => {
                const exec_count = cov.branches?.[idx].executed || 0;
                return new BranchCoverage(val.executed + exec_count);
            });

            // if existing had less branches than add remaining new branches
            const start = existing.branches?.length || 0;
            mergedBranches?.push(...cov.branches?.slice(start) || []);

            const merged = new StatementCoverage({
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
                    merged.kind = StatementCoverageKind.partial;

                    // only full is both full
                    if (existing.kind === StatementCoverageKind.full && cov.kind === StatementCoverageKind.full) {
                        merged.kind = StatementCoverageKind.full;
                    }

                    // only none if both none
                    if (existing.kind === StatementCoverageKind.none && cov.kind === StatementCoverageKind.none) {
                        merged.kind = StatementCoverageKind.none;
                    }
                }
            }

            log.info("MErged " + cov.scope + " with " + existing.scope);
            coverage.set(key, merged);
        } else {
            coverage.set(key, cov); // no existing, use the item
        }
    });

    const result = new FileCoverage(
        newCoverage.uri as Uri,
        Array.from(coverage.values()));
    return result;
}

export class Service {

    private config: Config;
    private outputChannel: LogOutputChannel;
    private coverageWatcher: FileSystemWatcher | undefined;
    private editorWatcher: Disposable | undefined;

    private coverageData: Map<string, SortedFileCoverage>;
    private rawCoverageData = new Map<string, FileCoverage[]>();


    private diagnostics = languages.createDiagnosticCollection("coverage");

    private diagParsers = new Map<string, IDiagParser>();
    private simple: SimpleDiagnosticParser;
    private simpleCov: SimpleCoverageParser;

    private lens: codelens.CodeLensProvider;

    private disposables: Disposable[] = [];

    private disabledScopes = new Set<string>();

    constructor(config: Config,
        outputChannel: LogOutputChannel,
    ) {
        this.config = config;
        this.outputChannel = outputChannel;
        this.lens = new codelens.CodeLensProvider(this, this.outputChannel);
        this.coverageData = new Map<string, SortedFileCoverage>();
        this.simple = new SimpleDiagnosticParser(outputChannel);
        // type mappings for diagnostic files
        this.diagParsers.set("simple", this.simple);

        this.simpleCov = new SimpleCoverageParser();

        this.disposables.push(languages.registerCodeLensProvider("*", this.lens));

    }

    public dispose() {
        this.outputChannel.debug("Disposing Servicatie");
        this.coverageWatcher?.dispose();

        this.disposables.forEach((x) => { x.dispose; });

    }

    /**
     * Is the scope not in the disabled list?
     * @param scope  Uri and scope name
     * @returns TRUE if is included in coverage
     */
    public isScopeEnabled(scope: Scope) {
        return this.disabledScopes.has(scope.toString()) === false;
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

        // any time the windows change, we need to redraw the cached data
        this.editorWatcher = window.onDidChangeActiveTextEditor(
            this.handleEditorEvents.bind(this),
        );
    }

    /**
     * Called when active editor changes
     * This allows us to update the decorations
     */
    private handleEditorEvents() {
        try {
            this.renderCoverageData();
        } finally {
            //            this.statusBar.setLoading(false);
        }
    }

    /**
     * process coverage information and update rednered
     * coverage
     */
    public async processCoverageData() {

        this.outputChannel.trace(`UPDATE COVERAGE DATA`);
        await this.updateCoverageData();

        this.outputChannel.trace(`RENDER COVERAGE DATA`);
        this.renderCoverageData();

        this.outputChannel.trace(`ALL DONE COVERAGE DATA`);
    }

    public async disableScope(uri: Uri, name: string, line: number) {

        const scope = new Scope({
            name: name,
            line: line,
            uri: uri
        });

        this.outputChannel.info(`Toggle ${scope}`);

        const key = scope.toString();
        if (this.disabledScopes.has(key)) {
            this.disabledScopes.delete(key);
        } else {
            this.disabledScopes.add(key);
        }

        try {
            // restore because filter has changed
            await this.sortCoverageFiles();

            // update render
            await this.renderCoverageData();
        } catch (e) {
            this.outputChannel.error(e as Error);
        }

        this.lens.notifyUpdated();
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


    /**
     * Render coverage information for active editors with
     * matching coverage files
     */
    private async renderCoverageData() {

        this.outputChannel.debug("Rendering coverage data");
        // only display for window.visibleTextEditors;
        window.visibleTextEditors.map((editor) => {

            this.outputChannel.trace(`rendering coverage for ` + editor.document.uri);
            const fc = this.coverageData.get(editor.document.uri.toString());

            // skip as there is no coverage data
            if (!fc) { return; }

            this.outputChannel.info('render ' + editor.document.uri.toString());
            this.outputChannel.info("FULL " + fc.full.toString());
            this.outputChannel.info("PART " + fc.partial.toString());
            this.outputChannel.info("NONE " + fc.none.toString());
            editor.setDecorations(
                this.config.fullDecoration,
                fc.full.map((lineno) => {
                    return {
                        range: editor.document.lineAt(lineno).range
                    };
                })
            );

            editor.setDecorations(
                this.config.partialDecoration,
                fc.partial.map((lineno) => {
                    return { range: editor.document.lineAt(lineno).range };
                })
            );

            editor.setDecorations(
                this.config.noneDecoration,
                fc.none.map((lineno) => {
                    return { range: editor.document.lineAt(lineno).range };
                })
            );

        });
    }

    /**
     * parse coverage information and update cache
     */
    private async updateCoverageData() {

        this.outputChannel.info("Updating Coverage data");

        // start fresh
        this.coverageData.clear();
        this.rawCoverageData.clear();

        // build FileCoverage lists for every Covered file
        for (const file of this.config.covFiles) {
            this.outputChannel.debug(`Reading coverage data from : ${file.path}`);
            await this.processCoverageFile(file);
        }

        this.lens.updateCoverageInfo(this.rawCoverageData);
        // sort/merge the FileCoverage lists
        await this.sortCoverageFiles();

        this.outputChannel.info(`Finished Coverage data`);
    }

    private async sortCoverageFiles() {

        await this.rawCoverageData.forEach((_, key) => {
            this.sortCoverageFile(key);
        });
    }

    /**
     * Sort data for a single file
     * @param path 
     */
    private async sortCoverageFile(path: string) {

        const uri = Uri.parse(path);
        // merge coverage by file
        let merged: FileCoverage | undefined = undefined;
        const coverage = this.rawCoverageData.get(path);

        this.outputChannel.info("Sorting " + path);

        await coverage?.forEach((cov) => {
            merged = mergeCoverageData(merged, cov, (cov) => {

                const scope = new Scope({
                    name: cov.scope || '',
                    line: cov.location,
                    uri: uri,
                });
                return this.isScopeEnabled(scope);
            },
                this.outputChannel);
        });

        if (merged !== undefined) {
            (merged as FileCoverage).coverage.forEach((x) => {
                this.outputChannel.debug(`merged: ${x.location} ${x.kind}`);
            });

            // sort by full,partial,none 
            const sc = sortCoverage(merged);
            this.coverageData.set(path, sc);
        }
    }

    private async processCoverageFile(file: IDataFile) {
        try {
            const data = await this.simpleCov.parse(file);

            //const data = await this.readJsonFile(file.path) as FileCoverage[];
            this.outputChannel.trace(`[${Date.now()}] finished reading   ${file.path}`);

            data.forEach((entry: FileCoverage) => {
                if (typeof entry.uri === 'string') {
                    entry.uri = resolveUri(file.baseDir, entry.uri as string);
                }

                const existing = this.rawCoverageData.get(entry.uri.toString()) || [];
                existing.push(entry);
                // first one needs to be place in map
                if (existing.length === 1) {
                    this.rawCoverageData.set(entry.uri.toString(), existing);
                }

                this.outputChannel.trace(`Created coverage data for : ${entry.uri}`);
            });

            this.outputChannel.debug(`finished parsing ${file.path}`);
        } catch (e) {
            this.outputChannel.error(`Error while reading ${file.path}`, e as Error);
        }

    }

    private async readJsonFile(filePath: Uri) {

        const rawData = await workspace.fs.readFile(filePath);
        const str = Buffer.from(rawData).toString('utf8');
        return JSON.parse(str);
    }
}