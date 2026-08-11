/** TypeScript import analysis and cross-platform containment helpers. */
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isPropertyAccessExpression,
  isStringLiteralLike,
  type Node,
  ScriptKind,
  ScriptTarget,
  SyntaxKind,
} from "typescript";

/** Static module references and unresolved dynamic loads found in one source file. */
export type SourceImports = {
  readonly nonLiteralModuleLoads: number;
  readonly specifiers: readonly string[];
};

/** Returns true when a resolved target is not contained by the resolved root. */
export const isOutsideRoot = (root: string, target: string): boolean => {
  const path = relative(resolve(root), resolve(target));
  return path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path);
};

const scriptKindFor = (file: string): ScriptKind => {
  if (file.endsWith(".tsx")) {
    return ScriptKind.TSX;
  }
  if (file.endsWith(".jsx")) {
    return ScriptKind.JSX;
  }
  return file.endsWith(".js") || file.endsWith(".mjs") || file.endsWith(".cjs")
    ? ScriptKind.JS
    : ScriptKind.TS;
};

/**
 * Reads static, type-only, dynamic-import, and CommonJS literal module references.
 * Non-literal import/require calls are counted so production boundaries can fail closed.
 */
export const sourceImports = (file: string, source: string): SourceImports => {
  const specifiers = new Set<string>();
  let nonLiteralModuleLoads = 0;
  const sourceFile = createSourceFile(file, source, ScriptTarget.Latest, true, scriptKindFor(file));

  const visit = (node: Node): void => {
    if (
      (isImportDeclaration(node) || isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.add(node.moduleSpecifier.text);
    } else if (
      isImportTypeNode(node) &&
      isLiteralTypeNode(node.argument) &&
      isStringLiteralLike(node.argument.literal)
    ) {
      specifiers.add(node.argument.literal.text);
    } else if (isImportEqualsDeclaration(node) && isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression && isStringLiteralLike(expression)) {
        specifiers.add(expression.text);
      } else {
        nonLiteralModuleLoads += 1;
      }
    } else if (
      isCallExpression(node) &&
      (node.expression.kind === SyntaxKind.ImportKeyword ||
        (isIdentifier(node.expression) && node.expression.text === "require") ||
        (isPropertyAccessExpression(node.expression) &&
          ((isIdentifier(node.expression.expression) &&
            node.expression.expression.text === "require" &&
            node.expression.name.text === "resolve") ||
            (isIdentifier(node.expression.expression) &&
              node.expression.expression.text === "module" &&
              node.expression.name.text === "require"))))
    ) {
      const argument = node.arguments[0];
      if (node.arguments.length === 1 && argument && isStringLiteralLike(argument)) {
        specifiers.add(argument.text);
      } else {
        nonLiteralModuleLoads += 1;
      }
    }
    forEachChild(node, visit);
  };

  visit(sourceFile);
  return { nonLiteralModuleLoads, specifiers: [...specifiers] };
};
