/**
 * 纯算术表达式求值器：递归下降，不执行任何 JS。
 *
 * 支持 + - * / % ^、括号、小数与一元正负号；^ 右结合，优先级高于乘除。
 * 任何非法字符、除零/溢出等非有限结果都返回 null。
 */

const WHITESPACE = /\s/;

export function evaluateArithmeticExpression(input: string): number | null {
  const s = input;
  let i = 0;

  const skip = (): void => {
    while (i < s.length && WHITESPACE.test(s[i]!)) i++;
  };

  const parsePrimary = (): number | null => {
    skip();
    if (s[i] === "(") {
      i++;
      const value = parseExpression();
      skip();
      if (value === null || s[i] !== ")") return null;
      i++;
      return value;
    }

    const start = i;
    let dot = false;
    while (i < s.length) {
      const c = s[i]!;
      if (c >= "0" && c <= "9") {
        i++;
        continue;
      }
      if (c === "." && !dot) {
        dot = true;
        i++;
        continue;
      }
      break;
    }
    if (i === start) return null;
    const value = Number(s.slice(start, i));
    return Number.isFinite(value) ? value : null;
  };

  const parsePower = (): number | null => {
    const base = parsePrimary();
    if (base === null) return null;
    skip();
    if (s[i] !== "^") return base;
    i++;
    const exponent = parseUnary();
    if (exponent === null) return null;
    const value = base ** exponent;
    return Number.isFinite(value) ? value : null;
  };

  const parseUnary = (): number | null => {
    skip();
    if (s[i] === "+" || s[i] === "-") {
      const sign = s[i] === "-" ? -1 : 1;
      i++;
      const value = parseUnary();
      return value === null ? null : sign * value;
    }
    return parsePower();
  };

  const parseTerm = (): number | null => {
    let value = parseUnary();
    if (value === null) return null;
    for (;;) {
      skip();
      const op = s[i];
      if (op !== "*" && op !== "/" && op !== "%") break;
      i++;
      const right = parseUnary();
      if (right === null) return null;
      value = op === "*" ? value * right : op === "/" ? value / right : value % right;
    }
    return value;
  };

  const parseExpression = (): number | null => {
    let value = parseTerm();
    if (value === null) return null;
    for (;;) {
      skip();
      const op = s[i];
      if (op !== "+" && op !== "-") break;
      i++;
      const right = parseTerm();
      if (right === null) return null;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  };

  // parseExpression 会先调用 parseTerm -> parseUnary -> parsePower -> parsePrimary，
  // 这里是函数声明提升后的实际入口；把定义放在最后避免循环引用歧义。
  const result = parseExpression();
  skip();
  if (result === null || i !== s.length || !Number.isFinite(result)) return null;
  return result;
}
