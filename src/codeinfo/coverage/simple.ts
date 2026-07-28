import {
    sortCoverage,
    ICoverageParser,
    StatementCoverage,
    FileCoverage,
    BranchCoverage,
} from './coverage';

import { IDataFile } from '../config';
import {
    Uri,
    workspace
} from 'vscode';
import { resolveUri } from '../config';

interface IStatementCoverage {
    executed: number,  // number of times line was executed
    branches: [number] | undefined; // branch exec info if any

    line: number,
    /**
     * Method / Function this line was in.  This is used for
     * templates where there may be multiple instantiations
     * for the same line
     */
    scope: string | undefined;
}
interface IFileCoverage {
    uri: string,
    coverage: IStatementCoverage[],
}

export class SimpleCoverageParser implements ICoverageParser {

    public async parse(file: IDataFile): Promise<ReadonlyArray<FileCoverage>> {

        const result: FileCoverage[] = [];
        const data = await this.readJsonFile(file.path) as IFileCoverage[];

        if (Array.isArray(data)) {
            data.forEach((entryRaw) => {
                const fullUri = resolveUri(file.baseDir, entryRaw.uri);

                // covert to real obj
                const coverage = entryRaw.coverage.map((stmt) => {

                    // convert to real object
                    const b = stmt.branches?.map((x) => {
                        return new BranchCoverage(x);
                    });
                    return new StatementCoverage({
                        executed: stmt.executed,
                        location: stmt.line - 1, // zero based
                        branches: b,
                        scope: stmt.scope
                    });
                });
                const entry = new FileCoverage(fullUri, coverage);
                const sc = sortCoverage(entry);

                result.push(entry);
                //this.coverageData.set(uri.toString(), sc);
                //this.outputChannel.trace(`Created coverage data for : ${entry.uri}`);
            });
        } else {
            // TODO: ERROR NOT AN ARRAY
        }

        return result;
    }

    private async readJsonFile(filePath: Uri) {
        const rawData = await workspace.fs.readFile(filePath);
        const str = Buffer.from(rawData).toString('utf8');
        return JSON.parse(str);
    }

}