import * as vscode from 'vscode';
import {
    IDataFile  
} from '../config';

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