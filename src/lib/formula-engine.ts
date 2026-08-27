/**
 * Formula Engine — safely parses and evaluates BoardOps formula expressions.
 *
 * Supported syntax:
 *   - Numbers: 42, 3.14, 0.5
 *   - Variables: var('total_expense')  or  var("billing.roomRent")
 *   - Operators: + - * / % ( ) 
 *   - Functions: ROUND(x, n), FLOOR(x), CEIL(x), ABS(x), MIN(a, b, ...), MAX(a, b, ...),
 *                IF(cond, then, else)
 *   - Comparisons (inside IF conditions): > < >= <= == !=
 *
 * The engine uses a tokenizer + recursive-descent parser (no eval() / no Function() — safe).
 * Returns { value, error?, tokens? }.
 *
 * PRD Module 12 — Formula Engine. DEC-004 (Formula Builder with slug support).
 */

export type FormulaVarResolver = (slug: string) => number;

export type EvalResult = {
  value: number;
  error?: string;
};

// ─────────────────────────────────────────────────────────────
// Tokenizer
// ─────────────────────────────────────────────────────────────

type TokenType =
  | "NUMBER"
  | "STRING"
  | "IDENT" // function names like ROUND, IF
  | "OP" // + - * / %
  | "LPAREN"
  | "RPAREN"
  | "COMMA"
  | "CMP" // > < >= <= == !=
  | "EOF";

type Token = { type: TokenType; value: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const ch = expr[i];
    // Whitespace
    if (/\s/.test(ch)) { i++; continue; }
    // Number (with decimals)
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expr[i + 1] || ""))) {
      let num = "";
      while (i < expr.length && /[0-9.]/.test(expr[i])) { num += expr[i]; i++; }
      tokens.push({ type: "NUMBER", value: num });
      continue;
    }
    // String literal (single or double quoted) — used inside var('...')
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let str = "";
      i++; // skip opening quote
      while (i < expr.length && expr[i] !== quote) { str += expr[i]; i++; }
      i++; // skip closing quote
      tokens.push({ type: "STRING", value: str });
      continue;
    }
    // Identifier (function names)
    if (/[A-Za-z_]/.test(ch)) {
      let id = "";
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) { id += expr[i]; i++; }
      tokens.push({ type: "IDENT", value: id });
      continue;
    }
    // Two-char comparison operators
    const two = expr.slice(i, i + 2);
    if (["<=", ">=", "==", "!="].includes(two)) {
      tokens.push({ type: "CMP", value: two });
      i += 2;
      continue;
    }
    // Single-char comparison operators
    if (ch === "<" || ch === ">") {
      tokens.push({ type: "CMP", value: ch });
      i++;
      continue;
    }
    // Operators
    if ("+-*/%".includes(ch)) {
      tokens.push({ type: "OP", value: ch });
      i++;
      continue;
    }
    if (ch === "(") { tokens.push({ type: "LPAREN", value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "RPAREN", value: ch }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "COMMA", value: ch }); i++; continue; }
    throw new Error(`Unexpected character "${ch}" at position ${i}`);
  }
  tokens.push({ type: "EOF", value: "" });
  return tokens;
}

// ─────────────────────────────────────────────────────────────
// Parser (recursive descent) → AST
// ─────────────────────────────────────────────────────────────

type AST =
  | { kind: "num"; value: number }
  | { kind: "var"; slug: string }
  | { kind: "binop"; op: string; left: AST; right: AST }
  | { kind: "cmp"; op: string; left: AST; right: AST }
  | { kind: "call"; name: string; args: AST[] };

class Parser {
  private pos = 0;
  constructor(private tokens: Token[]) {}

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }

  parse(): AST {
    const node = this.parseExpr();
    if (this.peek().type !== "EOF") {
      throw new Error(`Unexpected token "${this.peek().value}" at position ${this.pos}`);
    }
    return node;
  }

  // expr := cmpExpr
  private parseExpr(): AST { return this.parseCmp(); }

  // cmpExpr := addExpr (CMP addExpr)*
  private parseCmp(): AST {
    let left = this.parseAdd();
    while (this.peek().type === "CMP") {
      const op = this.next().value;
      const right = this.parseAdd();
      left = { kind: "cmp", op, left, right };
    }
    return left;
  }

  // addExpr := mulExpr ((+|-) mulExpr)*
  private parseAdd(): AST {
    let left = this.parseMul();
    while (this.peek().type === "OP" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      const right = this.parseMul();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  // mulExpr := unary ((*|/|%) unary)*
  private parseMul(): AST {
    let left = this.parseUnary();
    while (this.peek().type === "OP" && "*/%".includes(this.peek().value)) {
      const op = this.next().value;
      const right = this.parseUnary();
      left = { kind: "binop", op, left, right };
    }
    return left;
  }

  // unary := (-)? primary
  private parseUnary(): AST {
    if (this.peek().type === "OP" && this.peek().value === "-") {
      this.next();
      const operand = this.parseUnary();
      // Represent -x as 0 - x
      return { kind: "binop", op: "-", left: { kind: "num", value: 0 }, right: operand };
    }
    if (this.peek().type === "OP" && this.peek().value === "+") {
      this.next();
      return this.parseUnary();
    }
    return this.parsePrimary();
  }

  // primary := NUMBER | var('slug') | IDENT(args) | ( expr )
  private parsePrimary(): AST {
    const t = this.peek();
    if (t.type === "NUMBER") {
      this.next();
      return { kind: "num", value: parseFloat(t.value) };
    }
    if (t.type === "IDENT") {
      this.next();
      const name = t.value.toUpperCase();
      // var('slug') — variable lookup
      if (name === "VAR") {
        if (this.peek().type !== "LPAREN") throw new Error("Expected ( after var");
        this.next();
        if (this.peek().type !== "STRING") throw new Error("var() requires a string slug argument");
        const slug = this.next().value;
        if (this.peek().type !== "RPAREN") throw new Error("Expected ) after var slug");
        this.next();
        return { kind: "var", slug };
      }
      // Function call: NAME(args)
      if (this.peek().type === "LPAREN") {
        this.next();
        const args: AST[] = [];
        if (this.peek().type !== "RPAREN") {
          args.push(this.parseExpr());
          while (this.peek().type === "COMMA") {
            this.next();
            args.push(this.parseExpr());
          }
        }
        if (this.peek().type !== "RPAREN") throw new Error(`Expected ) after ${name} arguments`);
        this.next();
        return { kind: "call", name, args };
      }
      throw new Error(`Unknown identifier "${t.value}" (use var('slug') for variables, or a function name)`);
    }
    if (t.type === "LPAREN") {
      this.next();
      const node = this.parseExpr();
      if (this.peek().type !== "RPAREN") throw new Error("Expected )");
      this.next();
      return node;
    }
    throw new Error(`Unexpected token "${t.value}" (${t.type})`);
  }
}

// ─────────────────────────────────────────────────────────────
// Evaluator
// ─────────────────────────────────────────────────────────────

const SUPPORTED_FUNCS = new Set([
  "ROUND", "FLOOR", "CEIL", "ABS", "MIN", "MAX", "IF",
  "SUM", "AVG", "COUNT", "ROUNDUP", "ROUNDDOWN",
  "AND", "OR", "NOT", "POWER", "SQRT", "MOD",
  "COALESCE", "NULLIF",
]);

function evalAST(node: AST, resolveVar: FormulaVarResolver): number {
  switch (node.kind) {
    case "num":
      return node.value;
    case "var": {
      const v = resolveVar(node.slug);
      if (typeof v !== "number" || isNaN(v)) {
        throw new Error(`Variable "${node.slug}" is not a number (got ${v})`);
      }
      return v;
    }
    case "binop": {
      const l = evalAST(node.left, resolveVar);
      const r = evalAST(node.right, resolveVar);
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/":
          if (r === 0) throw new Error("Division by zero");
          return l / r;
        case "%":
          if (r === 0) throw new Error("Modulo by zero");
          return l % r;
      }
      throw new Error(`Unknown operator ${node.op}`);
    }
    case "cmp": {
      const l = evalAST(node.left, resolveVar);
      const r = evalAST(node.right, resolveVar);
      let result: boolean;
      switch (node.op) {
        case ">": result = l > r; break;
        case "<": result = l < r; break;
        case ">=": result = l >= r; break;
        case "<=": result = l <= r; break;
        case "==": result = l === r; break;
        case "!=": result = l !== r; break;
        default: throw new Error(`Unknown comparison ${node.op}`);
      }
      return result ? 1 : 0;
    }
    case "call": {
      if (!SUPPORTED_FUNCS.has(node.name)) {
        throw new Error(`Unknown function "${node.name}". Supported: ${Array.from(SUPPORTED_FUNCS).join(", ")}`);
      }
      const args = node.args.map((a) => evalAST(a, resolveVar));
      switch (node.name) {
        case "ROUND":
          if (args.length < 1 || args.length > 2) throw new Error("ROUND(x, n?) requires 1-2 args");
          const n = args.length === 2 ? args[1] : 0;
          const factor = Math.pow(10, n);
          return Math.round(args[0] * factor) / factor;
        case "FLOOR": return Math.floor(args[0]);
        case "CEIL": return Math.ceil(args[0]);
        case "ABS": return Math.abs(args[0]);
        case "MIN": return Math.min(...args);
        case "MAX": return Math.max(...args);
        case "IF":
          if (args.length !== 3) throw new Error("IF(cond, then, else) requires 3 args");
          return args[0] !== 0 ? args[1] : args[2];
        case "SUM": return args.reduce((s, a) => s + a, 0);
        case "AVG": return args.length > 0 ? args.reduce((s, a) => s + a, 0) / args.length : 0;
        case "COUNT": return args.length;
        case "ROUNDUP": return Math.ceil(args[0]);
        case "ROUNDDOWN": return Math.floor(args[0]);
        case "AND": return args.every((a) => a !== 0) ? 1 : 0;
        case "OR": return args.some((a) => a !== 0) ? 1 : 0;
        case "NOT": return args[0] === 0 ? 1 : 0;
        case "POWER": return Math.pow(args[0], args[1]);
        case "SQRT": return Math.sqrt(args[0]);
        case "MOD": if (args[1] === 0) throw new Error("MOD division by zero"); return args[0] % args[1];
        case "COALESCE": return args.find((a) => a !== 0 && !isNaN(a)) ?? 0;
        case "NULLIF": return args[0] === args[1] ? 0 : args[0];
      }
      throw new Error(`Unimplemented function ${node.name}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/** Evaluate a formula expression with the given variable resolver. */
export function evaluateFormula(expr: string, resolveVar: FormulaVarResolver): EvalResult {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    const value = evalAST(ast, resolveVar);
    if (typeof value !== "number" || !isFinite(value)) {
      return { value: 0, error: "Result is not a finite number" };
    }
    return { value };
  } catch (e) {
    return { value: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Validate a formula expression (syntax + function names) without evaluating it. */
export function validateFormula(expr: string): { valid: boolean; error?: string } {
  try {
    const tokens = tokenize(expr);
    const parser = new Parser(tokens);
    parser.parse();
    return { valid: true };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Extract all variable slugs referenced in a formula expression. */
export function extractVarSlugs(expr: string): string[] {
  const slugs: string[] = [];
  const regex = /var\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = regex.exec(expr)) !== null) {
    slugs.push(match[1]);
  }
  return Array.from(new Set(slugs));
}

/** List of supported functions (for UI display). */
export const FORMULA_FUNCTIONS = [
  { name: "ROUND", sig: "ROUND(x, n?)", desc: "Round x to n decimal places (default 0)" },
  { name: "ROUNDUP", sig: "ROUNDUP(x)", desc: "Round up to nearest integer" },
  { name: "ROUNDDOWN", sig: "ROUNDDOWN(x)", desc: "Round down to nearest integer" },
  { name: "FLOOR", sig: "FLOOR(x)", desc: "Round down to the nearest integer" },
  { name: "CEIL", sig: "CEIL(x)", desc: "Round up to the nearest integer" },
  { name: "ABS", sig: "ABS(x)", desc: "Absolute value" },
  { name: "MIN", sig: "MIN(a, b, ...)", desc: "Minimum of all arguments" },
  { name: "MAX", sig: "MAX(a, b, ...)", desc: "Maximum of all arguments" },
  { name: "SUM", sig: "SUM(a, b, ...)", desc: "Sum of all arguments" },
  { name: "AVG", sig: "AVG(a, b, ...)", desc: "Average of all arguments" },
  { name: "COUNT", sig: "COUNT(a, b, ...)", desc: "Count of arguments" },
  { name: "IF", sig: "IF(cond, then, else)", desc: "Conditional — cond uses >, <, >=, <=, ==, !=" },
  { name: "AND", sig: "AND(a, b, ...)", desc: "Logical AND — all must be true (non-zero)" },
  { name: "OR", sig: "OR(a, b, ...)", desc: "Logical OR — any must be true (non-zero)" },
  { name: "NOT", sig: "NOT(x)", desc: "Logical NOT — returns 1 if x is 0, else 0" },
  { name: "POWER", sig: "POWER(base, exp)", desc: "Base raised to the power of exp" },
  { name: "SQRT", sig: "SQRT(x)", desc: "Square root" },
  { name: "MOD", sig: "MOD(a, b)", desc: "Modulo (remainder of a / b)" },
  { name: "COALESCE", sig: "COALESCE(a, b, ...)", desc: "Returns first non-zero argument" },
  { name: "NULLIF", sig: "NULLIF(a, b)", desc: "Returns 0 if a equals b, else a" },
];

export const FORMULA_OPERATORS = ["+", "-", "*", "/", "%", "(", ")"];
