import * as vscode from "vscode";
import fs = require("fs");
import path = require("path");
import { AiderInterface, AiderTerminal } from "./AiderTerminal";

class AiderState {
  aider: AiderInterface | null = null;
  filesThatAiderKnows = new Set<string>();

  constructor() {
    console.log("creating aider state");
  }

  /**
   * Creates a new instance of the AiderState class.
   *
   * @return AiderState instance
   */
  createAider() {
    console.log("creating new aider terminal");
    const config = vscode.workspace.getConfiguration("cisco");
    let openaiApiKey: string | null | undefined = config.get("apiKey");
    let aiderCommandLine: string = config.get("commandLine") ?? "aider";
    let workingDirectory: string | undefined = config.get("workingDirectory");

    findWorkingDirectory(workingDirectory)
      .then((workingDirectory) => {
        this.aider = new AiderTerminal(
          openaiApiKey,
          aiderCommandLine,
          this.handleAiderClose,
          workingDirectory
        );
        this.syncAiderAndVSCodeFiles();
        this.aider.show();
      })
      .catch((err) => {
        vscode.window.showErrorMessage(`Error starting Aider: ${err}`);
      });
  }

  /**
   * Handles the close event of the Aider interface.
   *
   * @param event - The close event object
   * @return Void
   */
  handleAiderClose() {
    this.aider?.dispose();
    this.aider = null;
  }

  /**
   * Synchronizes the Aider state with VS Code files.
   *
   * @param files - The set of files to sync
   * @return Void
   */
  syncAiderAndVSCodeFiles() {
    try {
      let filesThatVSCodeKnows = new Set<string>();
      vscode.workspace.textDocuments.forEach((document) => {
        if (
          document.uri.scheme === "file" &&
          document.fileName &&
          this.aider?.isWorkspaceFile(document.fileName)
        ) {
          filesThatVSCodeKnows.add(document.fileName);
        }
      });

      let opened = [...filesThatVSCodeKnows].filter(
        (x) => !this.filesThatAiderKnows.has(x)
      );
      let closed = [...this.filesThatAiderKnows].filter(
        (x) => !filesThatVSCodeKnows.has(x)
      );

      let ignoreFiles = vscode.workspace
        .getConfiguration("aider")
        .get("ignoreFiles") as string[] || [];
      let ignoreFilesRegex = ignoreFiles.map((regex) => new RegExp(regex));

      opened = opened.filter(
        (item) => !ignoreFilesRegex.some((regex) => regex.test(item))
      );
      this.aider?.addFiles(opened);

      closed = closed.filter(
        (item) => !ignoreFilesRegex.some((regex) => regex.test(item))
      );
      this.aider?.dropFiles(closed);

      this.filesThatAiderKnows = filesThatVSCodeKnows;
    } catch (e) {
      console.log("error syncing aider and vscode: ", e);
    }
  }
}

function findGitDirectoryInSelfOrParents(filePath: string): string {
  let dirs: string[] = filePath.split(path.sep).filter((item) => {
    return item !== "";
  });
  while (dirs.length > 0) {
    try {
      let isWin = path.sep === "\\";
      let dir;
      if (dirs && isWin) {
        dir = dirs.join("\\") + "\\.git";
      } else {
        dir = "/" + dirs.join("/") + "/.git";
      }
      if (fs.statSync(dir) !== undefined) {
        if (isWin) {
          return dirs.join("\\") + "\\";
        } else {
          return "/" + dirs.join("/") + "/";
        }
      } else {
        dirs.pop();
      }
    } catch (err) {
      dirs.pop();
    }
  }

  return "/";
}

/**
 * Find a working directory for Aider.
 *
 * @returns A promise pointing to a working directory for Aider.
 */
async function findWorkingDirectory(overridePath?: string): Promise<string> {
  if (overridePath && overridePath.trim() !== "") {
    return overridePath;
  }
  // If there is more than one workspace folder, ask the user which workspace they want aider for
  if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length > 1
  ) {
    let items: vscode.QuickPickItem[] = [];
    for (let workspaceFolder of vscode.workspace.workspaceFolders) {
      items.push({
        label: workspaceFolder.name,
        description: workspaceFolder.uri.fsPath,
      });
    }
    items.push({ label: "Select a folder...", description: "" });

    let workspaceThen = vscode.window.showQuickPick(items, {
      placeHolder: "Select a folder to use with Aider",
    });
    let workspace = await workspaceThen;
    if (workspace) {
      if (workspace.label === "Select a folder...") {
        let otherFolderThen = vscode.window.showOpenDialog({
          canSelectFiles: false,
          canSelectFolders: true,
          canSelectMany: false,
        });
        let otherFolder = await otherFolderThen;
        if (otherFolder) {
          return findGitDirectoryInSelfOrParents(otherFolder[0].fsPath);
        } else {
          throw new Error(
            "Starting Aider requires a workspace folder.  Aborting..."
          );
        }
      }

      return findGitDirectoryInSelfOrParents(workspace.description!);
    } else {
      throw new Error(
        "Starting Aider requires a workspace folder.  Aborting..."
      );
    }
  } else if (
    vscode.workspace.workspaceFolders &&
    vscode.workspace.workspaceFolders.length == 1
  ) {
    let workspaceFolder = vscode.workspace.workspaceFolders[0];
    return findGitDirectoryInSelfOrParents(workspaceFolder.uri.fsPath);
  } else if (vscode.window.activeTextEditor?.document?.fileName) {
    let filePath = vscode.window.activeTextEditor.document.fileName;
    let components = filePath.split("/");
    components.pop();
    filePath = components.join("/");
    return findGitDirectoryInSelfOrParents(filePath);
  } else {
    let otherFolderThen = vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
    });
    let otherFolder = await otherFolderThen;
    if (otherFolder) {
      return findGitDirectoryInSelfOrParents(otherFolder[0].fsPath);
    } else {
      throw new Error(
        "Starting Aider requires a workspace folder.  Aborting..."
      );
    }
  }
}

export { AiderState, findWorkingDirectory, findGitDirectoryInSelfOrParents };
