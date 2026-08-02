import * as vscode from 'vscode';
import {
    Config,
    IDataFile,
    resolveUri
} from '../config';
import { SimpleCoverageParser } from './simple';

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

export enum StatementCoverageKind {
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
    uri: vscode.Uri | string;
    coverage: StatementCoverage[];

    /**
     * @param uri Covered file URI
     * @param statementCoverage Statement coverage information. If the reporter
     * does not provide statement coverage information, this can instead be
     * used to represent line coverage.
     */
    constructor(uri: vscode.Uri, coverage: StatementCoverage[]) {
        this.uri = uri;
        this.coverage = coverage;
    }
};

export interface SortedFileCoverage {
    uri: vscode.Uri;
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
        uri: coverage.uri as vscode.Uri,
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


export class Scope {
    name: string;
    line: number;
    uri: vscode.Uri;

    constructor(obj: { name: string, line: number, uri: vscode.Uri }) {
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

/**
 * Merge two coverage lists
 * @param oldCoverage  Existing coverage
 * @param newCoverage  new coverage
 * @param matcher      how to match two FileCoverage objects
 * @returns  old and new coverage numbers merged
 */
async function mergeCoverageData(
    oldCoverage: FileCoverage | undefined,
    newCoverage: FileCoverage,
    matcher: (value: StatementCoverage) => boolean,
    log: vscode.LogOutputChannel
): Promise<FileCoverage> {

    //sort lines for lineno and scope
    const coverage = new Map<number, StatementCoverage>();

    if (oldCoverage) {
        // condence by line number
        await Promise.all(oldCoverage.coverage.map(async (cov: StatementCoverage) => {
            const key = cov.location;
            const existing = coverage.get(key);
            if (existing) {
                coverage.set(key, new StatementCoverage({
                    executed: existing.executed + cov.executed, // merge the exec count
                    location: existing.location,
                    // merge the two branch exec counts
                    branches: existing.branches?.map((val, idx) => {
                        const exec_count = cov.branches?.[idx]?.executed || 0;
                        return new BranchCoverage(val.executed + exec_count);
                    })
                }));
            } else {
                coverage.set(key, cov); // no existing, use the item
            }
        }));
    }

    await Promise.all(newCoverage.coverage.map(async (cov: StatementCoverage) => {

        // ignore this?
        if (!matcher(cov)) { return; }

        const key = cov.location;
        const existing = coverage.get(key);

        if (!existing) {
            coverage.set(key, cov); // no existing, use the item
            return;
        }

        // merge the two branch exec counts
        const mergedBranches = existing.branches ?
            await Promise.all(existing.branches.map(async (val, idx) => {
                const exec_count = cov.branches?.[idx]?.executed || 0;
                return new BranchCoverage(val.executed + exec_count);
            }))
            : [];

        // if existing had less branches than add remaining new branches
        const start = existing.branches?.length || 0;
        mergedBranches.push(...cov.branches?.slice(start) || []);

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
            | full   |   part  | part
            | full   |   none  | part
            | part   |   part  | part
            | part   |   none  | part
            | part   |   full  | part
            | none   |   full  | part
            | none   |   part  | part
            | none   |   none  | none
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
        coverage.set(key, merged);

    }));

    const result = new FileCoverage(
        newCoverage.uri as vscode.Uri,
        Array.from(coverage.values()));
    return result;
}

/**
 * Track cover for all the files
 */
export class Coverage {

    private logger: vscode.LogOutputChannel;
    private editorWatcher: vscode.Disposable;
    private config: Config;
    private simpleCov = new SimpleCoverageParser();

    // coverage data by file URI
    private coverageData = new Map<string, FileCoverage>();

    // scopes by file URI
    private scopeData = new Map<string, Scope[]>();
    private disabledScopes = new Set<string>();

    constructor(output: vscode.LogOutputChannel, config: Config) {
        this.logger = output;
        this.config = config;

        // any time the windows change, we need to redraw the cached data
        this.editorWatcher = vscode.window.onDidChangeActiveTextEditor(
            this.handleEditorEvents.bind(this),
        );
    }

    public dispose() {
        this.editorWatcher.dispose();
    }

    /**
 * Is the scope not in the disabled list?
 * @param scope  Uri and scope name
 * @returns TRUE if is included in coverage
 */
    public isScopeEnabled(scope: Scope) {
        return this.disabledScopes.has(scope.toString()) === false;
    }

    public async toggleScopes(scopes: { picked?: boolean, scope: Scope }[]) {

        scopes.forEach((item) => {

            const key = item.scope.toString();
            const en = item.picked;
            if (en) {
                this.disabledScopes.delete(key);
            } else {
                this.disabledScopes.add(key);
            }
        });

        // once updated, render all
        // TODO: find a faster way if this is too slow
        // this has to read all coverage files again and 
        // merge, as "merge" is the step where scopes are combinded
        await this.updateCoverageData();
    }


    /**
     * read from configured converage files
     */
    public async updateCoverageData() {

        const allCoverage = new Map<string, FileCoverage[]>();

        // wait for all of these before rendering
        await Promise.all(this.config.covFiles.map(async (file) => {
            await this.readCoverageFile(file, allCoverage);
        }));

        // merge coverage data into 1 per uri
        await this.reduceCoverageData(allCoverage);

        this.renderAllCoverage();
    }

    /**
     * Merge allCoverage into this,coverageData (ie 1 per Uri instead of n per Uri)
     * @param allCoverage  all loaded coverage data, not merged
     */
    private async reduceCoverageData(allCoverage: Map<string, FileCoverage[]>) {

        this.coverageData.clear(); // start fresh

        await Promise.all(Array.from(allCoverage.keys()).map(
            async (uri) => {
                await this.reduceCoverageFile(vscode.Uri.parse(uri), allCoverage);
            })
        );
    }

    private async renderAllCoverage() {
        // update the display now that all files were processed
        vscode.window.visibleTextEditors.forEach((e) => {
            this.renderCoverage(e);
        });
    }

    /**
     * Read a given coverage file and import its data into allCoverage
     * @param uri file path
     * @param allCoverage Where to store results
     */
    private async reduceCoverageFile(uri: vscode.Uri, allCoverage: Map<string, FileCoverage[]>) {
        let merged: FileCoverage | undefined = undefined;

        const coverage = allCoverage.get(uri.toString()) || [];
        const scopeAtLine = new Map<string, number>();
        await Promise.all(coverage.map(async (cov: FileCoverage) => {

            // reduce scopes
            cov.coverage.forEach((st) => {
                if (!st.scope) { return; }
                // store the lowest line number of a given scope
                const line = scopeAtLine.get(st.scope) || st.location;
                scopeAtLine.set(st.scope, Math.min(line, st.location));
            });

            merged = await mergeCoverageData(
                merged,
                cov,
                (stCov: StatementCoverage): boolean => {
                    const scope = new Scope({
                        name: stCov.scope || '',
                        line: stCov.location,
                        uri: uri,
                    });
                    return this.isScopeEnabled(scope);
                },
                this.logger);
        }));

        // had coverage data
        if (merged) {
            this.coverageData.set(uri.toString(), merged);
        }

        // build scopes
        const scopes: Scope[] = [];
        await Promise.all([...scopeAtLine].map(([name, line]) => {
            scopes.push( new Scope({
                name: name,
                line: line,
                uri: uri,
            }));
        }));

        this.scopeData.set(uri.toString(), scopes);
    }

    /**
     * Read a single configured file
     * Adds to this.coverageData
     * @param file path to read
     */
    private async readCoverageFile(file: IDataFile, allCoverage: Map<string, FileCoverage[]>) {

        const data = await this.simpleCov.parse(file);

        data.forEach((entry: FileCoverage) => {
            if (typeof entry.uri === 'string') {
                entry.uri = resolveUri(file.baseDir, entry.uri as string);
            }

            const urlStr = entry.uri.toString();

            const existing = allCoverage.get(urlStr) || [];
            existing.push(entry);
            // first one needs to be place in map
            if (existing.length === 1) {
                allCoverage.set(urlStr, existing);
            } else {
                this.logger.info("Updating existing with " + existing.length);
            }
        });
    }

    /**
     * Called when active editor changes
     * This allows us to update the decorations
     * @param editor new editor window
     */
    private handleEditorEvents(editor: vscode.TextEditor | undefined) {
        try {
            this.logger.info("new editor " + editor?.document.uri);
            if (editor) {
                this.renderCoverage(editor);
            }
            //this.renderCoverageData();
        } finally {
            //            this.statusBar.setLoading(false);
        }
    }

    /**
     * Render coverage data for the given uris
     * @param uri source document
     */
    private async renderCoverage(editor: vscode.TextEditor) {

        const fc = this.getSortedCoverage(editor.document.uri);

        if (!fc) {
            // no coverage data, unset any that was set before
            editor.setDecorations(this.config.fullDecoration, []);
            editor.setDecorations(this.config.partialDecoration, []);
            editor.setDecorations(this.config.noneDecoration, []);
        } else {
            editor.setDecorations(this.config.fullDecoration,
                fc.full.map((lineno) => {
                    return {
                        range: editor.document.lineAt(lineno).range
                    };
                }));


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
        }
    }
    /**
     * Find coverage data for a given file
     * @param uri requesting uri
     */
    public getSortedCoverage(uri: vscode.Uri): SortedFileCoverage | undefined {

        const unsorted = this.getCoverage(uri);
        if (!unsorted) { return undefined; }
        const sorted = sortCoverage(unsorted);
        // TODO: cache?
        return sorted;
    };

    /**
     * Get basic coverage data for a given uri
     * @param uri request coverage data for this
     * @returns undefined if no data available
     */
    public getCoverage(uri: vscode.Uri): FileCoverage | undefined {
        return this.coverageData.get(uri.toString());
    }
    public getScopes(uri: vscode.Uri): Scope[] {
        return this.scopeData.get(uri.toString()) || [];
    }
}