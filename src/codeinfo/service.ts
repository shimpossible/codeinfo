import { Config, IDataFile, resolveUri} from "./config";
import {
    Disposable,
    FileSystemWatcher,
    LogOutputChannel,
    Position,
    Range,
    Uri,
    window,
    workspace,
    Diagnostic,
    DiagnosticSeverity,
    languages,
    DiagnosticRelatedInformation,
    Location,
} from "vscode";

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

export class StatementCoverage {
    executed: number;
    location: number;
    branches?: BranchCoverage[];

    kind: StatementCoverageKind;

    /**
     * @param location The statement position/line.
     * @param executed The number of times this statement was executed,
     *  If zero, the statement will be marked as un-covered.
     * @param branches Coverage from branches of this line.  If it's not a
     * conditional, this should be omitted.
     */
    constructor(executed: number, location: number, branches?: BranchCoverage[]) {
        this.executed = executed;
        this.location = location;
        this.branches = branches;

        if (branches?.length) {
            // branches on this line, so must execute all of them to get FULL
            const num_executed = branches?.reduce((sum, b) => { return sum + b.executed; }, 0);
            if (num_executed === branches?.length) {
                this.kind = StatementCoverageKind.full;
            } else if (num_executed === 0) {
                this.kind = StatementCoverageKind.none;
            } else {
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
    readonly uri: string;
    coverage: StatementCoverage[];

    /**
     * @param uri Covered file URI
     * @param statementCoverage Statement coverage information. If the reporter
     * does not provide statement coverage information, this can instead be
     * used to represent line coverage.
     */
    constructor(uri: string, coverage: StatementCoverage[]) {
        this.uri = uri;
        this.coverage = coverage;
    }
};

export class SortedFileCoverage {
    uri: Uri;
    full: number[];
    partial: number[];
    none: number[];

    /**
     * Covert a FileCoverage into groups of full, partial and none lines
     * @param coverage FileCoverage
     */
    constructor(coverage: FileCoverage, baseDir: Uri) {

        this.uri = resolveUri(baseDir, coverage.uri);
        this.full = [];
        this.partial = [];
        this.none = [];

        // group by kind
        coverage.coverage.map((cov) => {
            if (cov.kind === StatementCoverageKind.full) {
                this.full.push(cov.location);
            } else if (cov.kind === StatementCoverageKind.partial) {
                this.partial.push(cov.location);
            } else if (cov.kind === StatementCoverageKind.none) {
                this.none.push(cov.location);
            }
        });
    }
}

interface IRelatedDiagnostc {
    /**
     * The message of this related diagnostic information.
     */
    message: string;
    path: string;

    /**
     * The one-based line value.
     */
    line: number;

    /**
     * The one-based character value.
     *
     * Character offsets are expressed using UTF-16 [code units](https://developer.mozilla.org/en-US/docs/Glossary/Code_unit).
     */
    offset: number;
};

interface IDiagnostic {
    message: string;

    /**
     * The one-based line value.
     */
    line: number;

    /**
     * The one-based character value.
     *
     * Character offsets are expressed using UTF-16 [code units](https://developer.mozilla.org/en-US/docs/Glossary/Code_unit).
     */
    offset: number;

    severity: string;
    source?: string;
    code?: string | number | {
        /**
         * A code or identifier for this diagnostic.
         * Should be used for later processing, e.g. when providing {@link CodeActionContext code actions}.
         */
        value: string | number;

        /**
         * A target URI to open with more information about the diagnostic error.
         */
        target: Uri;
    };
    related?: IRelatedDiagnostc[];
};

export class Service {

    private config: Config;
    private outputChannel: LogOutputChannel;
    private coverageWatcher: FileSystemWatcher | undefined;
    private editorWatcher: Disposable | undefined;

    private coverageData: Map<String, SortedFileCoverage>;

    private diagnostics = languages.createDiagnosticCollection("coverage");

    constructor(config: Config,
        outputChannel: LogOutputChannel,
    ) {
        this.config = config;
        this.outputChannel = outputChannel;
        this.coverageData = new Map<String, SortedFileCoverage>();
    }

    public dispose() {
        this.outputChannel.debug("Disposing Servicatie");
        this.coverageWatcher?.dispose();

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


    public async processDiagnosicData() {
        this.outputChannel.info("Updating Diagnostic data");

        await this.config.diagFiles.forEach(async (file) => {
            this.processDiagnosicFile(file);
        });
        this.outputChannel.info("Finished Diagnostic data");

    }

    /**
     * Process a single Diagnostic file
     * @param file diagnostic file to process
     */
    private async processDiagnosicFile(file: IDataFile) {
        this.outputChannel.trace(`File ${file.path} updated`);

        try {
            const data = await this.readJsonFile(file.path);
            const map = new Map<string, IDiagnostic[]>(Object.entries(data));
            this.updateDiagnosticFile(file, map);
        } catch (e) {
            this.outputChannel.error(`Error while reading ${file.path}`, e as Error);
        }
    }

    /**
     * 
     * @param file Information for the file that was parsed
     * @param data data parsed from file.  key is the relative path, and value is the problems/diagnostic
     */
    private async updateDiagnosticFile(file: IDataFile, map: Map<string, IDiagnostic[]>) {

        this.diagnostics.clear();

        const baseDir = file.baseDir;

        for (let [filePath, findings] of map.entries()) {
            try {
                this.outputChannel.trace(`Loaded: ${filePath}`);
                const fileUri = resolveUri(baseDir, filePath);

                if (Array.isArray(findings)) {
                    const problems = findings.map((value) => {
                        return this.createDiagnostic(baseDir, value);
                    });

                    this.diagnostics.set(fileUri, problems);
                } else {
                    this.outputChannel.error(`Error in ${file.path}  "${filePath}": "${findings}" is not an array`);
                }
            }
            catch (e) {
                this.outputChannel.error(`Error in ${file.path} processing ${filePath}:`, e as Error);
            }
        };
    }

    private sevMap: Map<String, DiagnosticSeverity> = new Map<String, DiagnosticSeverity>([
        ["error", DiagnosticSeverity.Error],
        ["warning", DiagnosticSeverity.Warning],
        ["info", DiagnosticSeverity.Information],
        ["hint", DiagnosticSeverity.Hint],
    ]);

    private createDiagnostic(baseDir: Uri, p: IDiagnostic): Diagnostic {
        const range = new Range(
            new Position(p.line - 1, p.offset - 1),
            new Position(p.line - 1, p.offset - 1),
        );
        const diag = new Diagnostic(range, p.message, this.sevMap.get(p.severity));
        diag.code = p.code;
        diag.source = p.source;
        diag.relatedInformation = this.createRelatedInfo(baseDir, p.related);
        return diag;
    }

    private createRelatedInfo(baseDir: Uri, related: IRelatedDiagnostc[] | undefined): DiagnosticRelatedInformation[] | undefined {

        return related?.map((value) => {

            const fullPath = resolveUri(baseDir, value.path);
            return new DiagnosticRelatedInformation(
                new Location(
                    fullPath,
                    new Position(value.line - 1, value.offset - 1),
                ),
                value.message);
        });
    }

    /**
     * Render coverage information for active editors with
     * matching coverage files
     */
    private async renderCoverageData() {

        this.outputChannel.debug("Rendering coverage data");
        // only display for window.visibleTextEditors;
        window.visibleTextEditors.map((editor) => {

            // clear our decorations for this editor
            editor.setDecorations(this.config.fullDecoration, []);

            this.outputChannel.trace(`rendering coverage for ` + editor.document.uri);
            const fc = this.coverageData.get(editor.document.uri.toString());

            // skip as there is no coverage data
            if (!fc) { return; }

            editor.setDecorations(
                this.config.fullDecoration,
                fc.full.map((lineno) => {
                    return { range: editor.document.lineAt(lineno).range };
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

        for (const file of this.config.covFiles) {
            this.outputChannel.debug(`Reading coverage data from : ${file.path}`);
            await this.processCoverageFile(file);
        }

        this.outputChannel.info(`Finished Coverage data`);
    }

    private async processCoverageFile(file: IDataFile) {
        try {
            const data = await this.readJsonFile(file.path) as FileCoverage[];
            this.outputChannel.trace(`[${Date.now()}] finished reading   ${file.path}`);

            data.forEach((entry) => {
                const uri = resolveUri(file.baseDir, entry.uri);
                //const uri = Uri.file(`${entry.uri}`);
                const sc = new SortedFileCoverage(entry, file.baseDir);
                this.coverageData.set(uri.toString(), sc);
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