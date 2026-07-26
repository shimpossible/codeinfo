// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { argon2 } from 'crypto';
import * as vscode from 'vscode';
import * as coverage from './codeinfo/service';

import {
	Config
} from './codeinfo/config';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	const outputChannel = vscode.window.createOutputChannel("CodeInfo", { log: true });
	const config = new Config(context, outputChannel);
	const service = new coverage.Service(config, outputChannel);

	const displayCoverage = vscode.commands.registerCommand(
		"codeinfo.displayCoverage",
		service.processCoverageData.bind(service),
	);
	const displayDiagnostics = vscode.commands.registerCommand(
		"codeinfo.displayDiagnostic",
		service.processDiagnosicData.bind(service),
	);

	const disableScope = vscode.commands.registerCommand(
		"codeinfo.coverage.disableScope",
		service.disableScope.bind(service),
	);

	context.subscriptions.push(displayCoverage);
	context.subscriptions.push(displayDiagnostics);
	context.subscriptions.push(disableScope);
	context.subscriptions.push(outputChannel);
	context.subscriptions.push(service);
	context.subscriptions.push(config);
	// start watching file system
	service.watchWorkspace();
}

// This method is called when your extension is deactivated
export function deactivate() { }
