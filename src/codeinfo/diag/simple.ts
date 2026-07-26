import { IDiagParser } from '../service';
import { IDataFile } from '../config';
import { resolveUri } from '../config';

import {
    Uri,
    LogOutputChannel,
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    Location, Position, Range,
    workspace,
} from 'vscode';

export interface IRelatedDiagnostc {
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

export interface IDiagnostic {
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


const sevMap: Map<String, DiagnosticSeverity> = new Map<String, DiagnosticSeverity>([
    ["error", DiagnosticSeverity.Error],
    ["warning", DiagnosticSeverity.Warning],
    ["info", DiagnosticSeverity.Information],
    ["hint", DiagnosticSeverity.Hint],
]);

export class SimpleDiagnosticParser implements IDiagParser {

    private outputChannel: LogOutputChannel;

    constructor(output: LogOutputChannel) {
        this.outputChannel = output;
    }

    /**
     * Given a URI parse Diagnostic data
     * @param path path to diagnostic file
     */
    public async parse(file: IDataFile): Promise<ReadonlyArray<[Uri, readonly Diagnostic[] | undefined]>> {
        const data = await this.readJsonFile(file.path);
        const map = new Map<string, IDiagnostic[]>(Object.entries(data));

        const baseDir = file.baseDir;

        const result: Array<[Uri, readonly Diagnostic[]]> = [];

        for (let [filePath, findings] of map.entries()) {
            try {
                this.outputChannel.trace(`Loaded: ${filePath}`);
                const fileUri = resolveUri(baseDir, filePath);

                if (Array.isArray(findings)) {
                    const problems = findings.map((value) => {
                        return this.createDiagnostic(baseDir, value);
                    });

                    result.push([fileUri, problems]);
                } else {
                    this.outputChannel.error(`Error in ${file.path}  "${filePath}": "${findings}" is not an array`);
                }
            }
            catch (e) {
                this.outputChannel.error(`Error in ${file.path} processing ${filePath}:`, e as Error);
            }
        };


        return result;
    }

    private createDiagnostic(baseDir: Uri, p: IDiagnostic): Diagnostic {
        const range = new Range(
            new Position(p.line - 1, p.offset - 1),
            new Position(p.line - 1, p.offset - 1),
        );
        const diag = new Diagnostic(range, p.message, sevMap.get(p.severity));
        diag.code = p.code;
        diag.source = p.source;
        diag.relatedInformation = this.createRelatedInfo(baseDir, p.related);
        return diag;
    }


    private async readJsonFile(filePath: Uri) {
        const rawData = await workspace.fs.readFile(filePath);
        const str = Buffer.from(rawData).toString('utf8');
        return JSON.parse(str);
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


}