import {
    // types
    ExtensionContext,
    LogOutputChannel,
    Uri,
    EventEmitter,Event,
    Disposable,
    // singletons
    workspace,
    window,
} from 'vscode';
import path, { resolve } from "path";


/**
 * Parsed file info converted to absoluate Uris
 */
export interface IDataFile {
    path: Uri;  // full path
    baseDir: Uri; // base path for relative files
    type: string; // type of file (unused)
}

/**
 * Raw file info from the Configuration
 */
interface IDataFileRaw {
    path: string;
    baseDir: string;
    type: string;
}


/**
 * Global config for the extension,
 * also reloads values from settings change.
 */
export class Config {

    private context: ExtensionContext;
    private outputChannel: LogOutputChannel;

    public fullDecoration = window.createTextEditorDecorationType({
        backgroundColor: 'blue',
    });
    public partialDecoration = window.createTextEditorDecorationType({
        backgroundColor: 'yellow',
    });
    public noneDecoration = window.createTextEditorDecorationType({
        backgroundColor: 'red',
    });

    public workspaceFolder: Uri = Uri.parse('');

    // diagnostic files
    public diagFiles: IDataFile[] = [];
    // coverage files
    public covFiles: IDataFile[] = [];

    /**
     * Display Coverage in editor?
     */
    public coverageEnabled: boolean;

    private _onDidChangeConfig: EventEmitter<void> = new EventEmitter<void>();
    public readonly onDidChangeConfig: Event<void> = this._onDidChangeConfig.event;

    private listener: Disposable;
    constructor(context: ExtensionContext,
        outputChannel: LogOutputChannel
    ) {
        this.context = context;
        this.outputChannel = outputChannel;
        this.coverageEnabled = true;
        this.setup();

        // run setup when config changes
        this.listener = workspace.onDidChangeConfiguration(this.setup.bind(this));
    }

    public dispose() {
        this.listener?.dispose();
    }
    private resolveVariables(value: string): string {

        const BEGIN_VAR: string = '${';

        const variables = new Map<string, string>([
            ["workspaceFolder", this.workspaceFolder.toString()]
        ]);

        let result = '';
        let pos = 0;
        while (pos < value.length) {

            const i = value.indexOf(BEGIN_VAR, pos);
            if (i === -1) { break; }; // no more variables

            if (i > 0) {
                result += value.slice(pos, i - 1);
            }
            const i_end = value.indexOf('}', i + BEGIN_VAR.length);
            if (i_end === -1) { break; } // no closing brace

            const name = value.slice(i + 2, i_end);
            // ignore unknown variables
            if (!variables.has(name)) {
                this.outputChannel.error("Unknown variable ${" + name + "}");
            }
            const replacement = variables.get(name) || '';

            // add resolved variable
            result += replacement;

            // skip past current
            pos = i_end + 1;
        }
        // append trailing
        if (pos < value.length) {
            result += value.slice(pos);
        }

        return result;
    }

    private setup() {

        if (workspace.workspaceFolders) {
            this.workspaceFolder = workspace.workspaceFolders[0].uri;
        }

        const rootConfig = workspace.getConfiguration("codeinfo");

        const diagPaths = rootConfig.get("diagnostic.paths") as IDataFileRaw[] | undefined;
        this.diagFiles.length = 0; // clear 
        diagPaths?.forEach((value) => {
            const path = this.resolveVariables(value.path);


            let baseDir = this.workspaceFolder;
            if (value.baseDir) {
                baseDir = Uri.parse(this.resolveVariables(value.baseDir));
            }

            this.diagFiles.push({
                path: resolveUri(this.workspaceFolder, path),
                baseDir: baseDir,
                type: '',
            });
        });

        const covPaths = rootConfig.get("coverage.paths") as IDataFileRaw[] | undefined;
        this.covFiles.length = 0;  // clear 
        covPaths?.forEach((value) => {
            const path = this.resolveVariables(value.path);


            let baseDir = this.workspaceFolder;
            if (value.baseDir) {
                baseDir = Uri.parse(this.resolveVariables(value.baseDir));
            }

            this.covFiles.push({
                path: resolveUri(this.workspaceFolder, path),
                baseDir: baseDir,
                type: '',
            });
        });

        this.coverageEnabled = rootConfig.get("coverage.enable", true);

        const coverageFullDark = rootConfig.get("coverage.fullDark", "rgba(0, 255, 0, 0.4)");
        const coverageFullLight = rootConfig.get("coverage.fullLight", "rgba(0, 255, 0, 0.4)");

        const coveragePartDark = rootConfig.get("coverage.partialDark", "rgba(163, 149, 0, 0.4)");
        const coveragePartLight = rootConfig.get("coverage.partialLight", "rgba(255, 235, 0, 0.2)");

        const coverageNoneDark = rootConfig.get("coverage.noneDark", "rgba(163, 0, 0, 0.4)");
        const coverageNoneLight = rootConfig.get("coverage.noneight", "rgba(255, 0, 0, 0.2)");

        // dispose existing to remove any decoration 
        // since deorations are tied to the instance we need
        // to remove these before creating NEW instances
        if (this.fullDecoration) {
            this.fullDecoration.dispose();
        }
        if (this.partialDecoration) {
            this.partialDecoration.dispose();
        }
        if (this.noneDecoration) {
            this.noneDecoration.dispose();
        }

        // how create new ones
        this.fullDecoration = window.createTextEditorDecorationType({
            dark: {
                backgroundColor: coverageFullDark
            },
            light: {
                backgroundColor: coverageFullLight
            },
            isWholeLine: true,
        });

        this.partialDecoration = window.createTextEditorDecorationType({
            dark: {
                backgroundColor: coveragePartDark
            },
            light: {
                backgroundColor: coveragePartLight
            },
            isWholeLine: true,
        });

        this.noneDecoration = window.createTextEditorDecorationType({
            dark: {
                backgroundColor: coverageNoneDark
            },
            light: {
                backgroundColor: coverageNoneLight
            },
            isWholeLine: true,
        });

        // notifyconfig changed 
        this._onDidChangeConfig.fire();
    }

}

/**
 * Resolve relative to a base URI.
 * if path is absolute, only the schema is kept
 * @param base Base for resolving
 * @param path absolate or relative path
 * @returns URL resolved to absolute URI
 */
export function resolveUri(base: Uri | string, path: string): Uri {

    if (typeof base === 'string') {
        base = Uri.parse(base);
    }

    const resolved = resolve(base.path, path);
    return Uri.from({ scheme: base.scheme, path: resolved });
}