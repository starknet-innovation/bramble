//! A small backtracking matcher for the JavaScript regular expressions the extension's activity
//! and amount formatting use (`activity-format.ts`, `token-row.ts`). Copying each pattern verbatim
//! and matching it with JavaScript's own rules (backtracking, ASCII `\b`/`\w`/`\d`, JavaScript
//! `\s`, `.` excluding line terminators, ASCII-only `i`) is what keeps the classification of a
//! summary identical across the two wallets; hand-translated string checks drifted in review.
//!
//! Supported syntax, and nothing more: alternation, capturing and non-capturing groups,
//! lookahead and lookbehind (positive and negative), `^`, `$`, `\b`, `\B`, `.`, classes with
//! ranges and negation, `\d \D \w \W \s \S`, identity escapes, and greedy `* + ? {n} {n,} {n,m}`.
//! Patterns are constants; an unsupported one panics in the unit tests, never at runtime input.

use super::num::is_js_whitespace;

#[derive(Debug, Clone)]
enum ClassItem {
    Char(char),
    Range(char, char),
    Digit(bool),
    Word(bool),
    Space(bool),
}

#[derive(Debug, Clone)]
enum Node {
    Char(char),
    Any,
    Class(Vec<ClassItem>, bool),
    Start,
    End,
    WordBoundary(bool),
    Group(Vec<Vec<Node>>, Option<usize>),
    Look(Vec<Vec<Node>>, bool, bool),
    Repeat(Box<Node>, usize, Option<usize>),
}

/// A compiled pattern.
#[derive(Debug, Clone)]
pub struct Regex {
    root: Vec<Vec<Node>>,
    groups: usize,
    ignore_case: bool,
}

/// One match: overall span and capture spans, in `char` indices of the searched text.
#[derive(Debug, Clone)]
pub struct Match {
    pub start: usize,
    pub end: usize,
    pub captures: Vec<Option<(usize, usize)>>,
}

type Caps = Vec<Option<(usize, usize)>>;

struct Compiler<'p> {
    chars: Vec<char>,
    pos: usize,
    groups: usize,
    _pattern: &'p str,
}

impl Compiler<'_> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).copied()
    }

    fn eat(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.pos += 1;
            true
        } else {
            false
        }
    }

    fn disjunction(&mut self) -> Vec<Vec<Node>> {
        let mut alternatives = vec![self.alternative()];
        while self.eat('|') {
            alternatives.push(self.alternative());
        }
        alternatives
    }

    fn alternative(&mut self) -> Vec<Node> {
        let mut nodes = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            let atom = self.atom();
            nodes.push(self.quantified(atom));
        }
        nodes
    }

    fn quantified(&mut self, atom: Node) -> Node {
        let (min, max) = match self.peek() {
            Some('*') => (0, None),
            Some('+') => (1, None),
            Some('?') => (0, Some(1)),
            Some('{') => {
                self.pos += 1;
                let min = self.number();
                let max = if self.eat(',') {
                    (self.peek() != Some('}')).then(|| self.number())
                } else {
                    Some(min)
                };
                assert!(self.eat('}'), "unterminated quantifier");
                return Node::Repeat(Box::new(atom), min, max);
            }
            _ => return atom,
        };
        self.pos += 1;
        assert!(
            self.peek() != Some('?'),
            "lazy quantifiers are not supported"
        );
        Node::Repeat(Box::new(atom), min, max)
    }

    fn number(&mut self) -> usize {
        let mut value = 0;
        while let Some(d) = self.peek().and_then(|c| c.to_digit(10)) {
            value = value * 10 + d as usize;
            self.pos += 1;
        }
        value
    }

    fn atom(&mut self) -> Node {
        let c = self.peek().expect("atom");
        self.pos += 1;
        match c {
            '.' => Node::Any,
            '^' => Node::Start,
            '$' => Node::End,
            '[' => self.class(),
            '(' => self.group(),
            '\\' => self.escape(),
            c => Node::Char(c),
        }
    }

    fn group(&mut self) -> Node {
        if self.eat('?') {
            let (ahead, negate) = if self.eat(':') {
                let inner = self.disjunction();
                assert!(self.eat(')'), "unterminated group");
                return Node::Group(inner, None);
            } else if self.eat('=') {
                (true, false)
            } else if self.eat('!') {
                (true, true)
            } else {
                assert!(self.eat('<'), "unsupported group");
                (false, self.eat('!') || !self.eat('='))
            };
            let inner = self.disjunction();
            assert!(self.eat(')'), "unterminated lookaround");
            return Node::Look(inner, ahead, negate);
        }
        self.groups += 1;
        let index = self.groups;
        let inner = self.disjunction();
        assert!(self.eat(')'), "unterminated group");
        Node::Group(inner, Some(index))
    }

    fn escape(&mut self) -> Node {
        let c = self.peek().expect("escape");
        self.pos += 1;
        match c {
            'b' => Node::WordBoundary(true),
            'B' => Node::WordBoundary(false),
            'd' | 'D' | 'w' | 'W' | 's' | 'S' => Node::Class(vec![Self::class_escape(c)], false),
            c if c.is_ascii_alphanumeric() => panic!("unsupported escape \\{c}"),
            c => Node::Char(c),
        }
    }

    fn class_escape(c: char) -> ClassItem {
        match c {
            'd' => ClassItem::Digit(true),
            'D' => ClassItem::Digit(false),
            'w' => ClassItem::Word(true),
            'W' => ClassItem::Word(false),
            's' => ClassItem::Space(true),
            _ => ClassItem::Space(false),
        }
    }

    fn class(&mut self) -> Node {
        let negated = self.eat('^');
        let mut items = Vec::new();
        loop {
            let c = self.peek().expect("unterminated class");
            self.pos += 1;
            let start = match c {
                ']' => break,
                '\\' => {
                    let e = self.peek().expect("escape");
                    self.pos += 1;
                    if "dDwWsS".contains(e) {
                        items.push(Self::class_escape(e));
                        continue;
                    }
                    assert!(!e.is_ascii_alphanumeric(), "unsupported class escape");
                    e
                }
                c => c,
            };
            if self.peek() == Some('-') && self.chars.get(self.pos + 1).is_some_and(|n| *n != ']') {
                self.pos += 1;
                let end = self.peek().expect("range end");
                self.pos += 1;
                items.push(ClassItem::Range(start, end));
            } else {
                items.push(ClassItem::Char(start));
            }
        }
        Node::Class(items, negated)
    }
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

struct Matcher<'a> {
    input: &'a [char],
    ignore_case: bool,
}

impl Matcher<'_> {
    fn same(&self, a: char, b: char) -> bool {
        a == b || (self.ignore_case && a.is_ascii() && a.eq_ignore_ascii_case(&b))
    }

    fn item(&self, item: &ClassItem, c: char) -> bool {
        let in_range = |lo: char, hi: char, c: char| lo <= c && c <= hi;
        match item {
            ClassItem::Char(x) => self.same(*x, c),
            ClassItem::Range(lo, hi) => {
                in_range(*lo, *hi, c)
                    || (self.ignore_case
                        && c.is_ascii_alphabetic()
                        && (in_range(*lo, *hi, c.to_ascii_lowercase())
                            || in_range(*lo, *hi, c.to_ascii_uppercase())))
            }
            ClassItem::Digit(yes) => c.is_ascii_digit() == *yes,
            ClassItem::Word(yes) => is_word(c) == *yes,
            ClassItem::Space(yes) => is_js_whitespace(c) == *yes,
        }
    }

    fn boundary(&self, pos: usize) -> bool {
        let before = pos > 0 && is_word(self.input[pos - 1]);
        let after = pos < self.input.len() && is_word(self.input[pos]);
        before != after
    }

    fn alts(
        &self,
        alts: &[Vec<Node>],
        pos: usize,
        caps: &mut Caps,
        k: &mut dyn FnMut(usize, &mut Caps) -> bool,
    ) -> bool {
        alts.iter().any(|alt| self.seq(alt, pos, caps, k))
    }

    fn one(
        &self,
        node: &Node,
        pos: usize,
        caps: &mut Caps,
        k: &mut dyn FnMut(usize, &mut Caps) -> bool,
    ) -> bool {
        self.seq(std::slice::from_ref(node), pos, caps, k)
    }

    fn seq(
        &self,
        seq: &[Node],
        pos: usize,
        caps: &mut Caps,
        k: &mut dyn FnMut(usize, &mut Caps) -> bool,
    ) -> bool {
        let Some((first, rest)) = seq.split_first() else {
            return k(pos, caps);
        };
        let at = self.input.get(pos).copied();
        match first {
            Node::Char(c) => {
                at.is_some_and(|a| self.same(*c, a)) && self.seq(rest, pos + 1, caps, k)
            }
            Node::Any => {
                at.is_some_and(|a| !is_line_terminator(a)) && self.seq(rest, pos + 1, caps, k)
            }
            Node::Class(items, negated) => {
                at.is_some_and(|a| items.iter().any(|i| self.item(i, a)) != *negated)
                    && self.seq(rest, pos + 1, caps, k)
            }
            Node::Start => pos == 0 && self.seq(rest, pos, caps, k),
            Node::End => pos == self.input.len() && self.seq(rest, pos, caps, k),
            Node::WordBoundary(yes) => self.boundary(pos) == *yes && self.seq(rest, pos, caps, k),
            Node::Group(alts, index) => self.alts(alts, pos, caps, &mut |end, caps| {
                let saved = index.map(|i| caps[i]);
                if let Some(i) = index {
                    caps[*i] = Some((pos, end));
                }
                if self.seq(rest, end, caps, k) {
                    return true;
                }
                if let (Some(i), Some(saved)) = (index, saved) {
                    caps[*i] = saved;
                }
                false
            }),
            Node::Look(alts, ahead, negate) => {
                let mut trial = caps.clone();
                let found = if *ahead {
                    self.alts(alts, pos, &mut trial, &mut |_, _| true)
                } else {
                    (0..=pos)
                        .rev()
                        .any(|start| self.alts(alts, start, &mut trial, &mut |end, _| end == pos))
                };
                if found == *negate {
                    return false;
                }
                if !*negate {
                    *caps = trial;
                }
                self.seq(rest, pos, caps, k)
            }
            Node::Repeat(node, min, max) => self.repeat(node, *min, *max, 0, pos, rest, caps, k),
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn repeat(
        &self,
        node: &Node,
        min: usize,
        max: Option<usize>,
        count: usize,
        pos: usize,
        rest: &[Node],
        caps: &mut Caps,
        k: &mut dyn FnMut(usize, &mut Caps) -> bool,
    ) -> bool {
        if max.is_none_or(|m| count < m)
            && self.one(node, pos, caps, &mut |end, caps| {
                if end == pos && count >= min {
                    return false;
                }
                self.repeat(node, min, max, count + 1, end, rest, caps, k)
            })
        {
            return true;
        }
        count >= min && self.seq(rest, pos, caps, k)
    }
}

impl Regex {
    /// Compiles a JavaScript pattern (`ignore_case` is the `i` flag).
    pub fn new(pattern: &str, ignore_case: bool) -> Self {
        let mut compiler = Compiler {
            chars: pattern.chars().collect(),
            pos: 0,
            groups: 0,
            _pattern: pattern,
        };
        let root = compiler.disjunction();
        assert!(compiler.pos == compiler.chars.len(), "unbalanced pattern");
        Self {
            root,
            groups: compiler.groups,
            ignore_case,
        }
    }

    /// Leftmost match starting at or after `from` (`RegExp.prototype.exec` with `lastIndex`).
    pub fn find_at(&self, input: &[char], from: usize) -> Option<Match> {
        let matcher = Matcher {
            input,
            ignore_case: self.ignore_case,
        };
        for start in from..=input.len() {
            let mut caps: Caps = vec![None; self.groups + 1];
            let mut end = None;
            if matcher.alts(&self.root, start, &mut caps, &mut |p, _| {
                end = Some(p);
                true
            }) {
                let end = end.expect("a match records its end");
                caps[0] = Some((start, end));
                return Some(Match {
                    start,
                    end,
                    captures: caps,
                });
            }
        }
        None
    }

    /// `regex.test(text)`.
    pub fn is_match(&self, text: &str) -> bool {
        let chars: Vec<char> = text.chars().collect();
        self.find_at(&chars, 0).is_some()
    }

    /// `regex.exec(text)` capture strings (index 0 is the whole match).
    pub fn captures(&self, text: &str) -> Option<Vec<Option<String>>> {
        let chars: Vec<char> = text.chars().collect();
        self.find_at(&chars, 0).map(|m| {
            m.captures
                .iter()
                .map(|span| span.map(|(s, e)| chars[s..e].iter().collect()))
                .collect()
        })
    }

    /// `text.replace(regex, f)`: the first match only (`global` false) or every match.
    pub fn replace(&self, text: &str, global: bool, mut f: impl FnMut(&str) -> String) -> String {
        let chars: Vec<char> = text.chars().collect();
        let mut out = String::new();
        let mut last = 0;
        let mut from = 0;
        while from <= chars.len() {
            let Some(m) = self.find_at(&chars, from) else {
                break;
            };
            out.extend(&chars[last..m.start]);
            let matched: String = chars[m.start..m.end].iter().collect();
            out.push_str(&f(&matched));
            last = m.end;
            if !global {
                break;
            }
            from = if m.end == m.start { m.end + 1 } else { m.end };
        }
        out.extend(&chars[last.min(chars.len())..]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_semantics() {
        let swap = Regex::new(r"\bswap(ped|ping)?\b", false);
        assert!(swap.is_match("i swapped 1 eth"));
        assert!(!swap.is_match("swapp"));
        let group = Regex::new(r"\B(?=(\d{3})+(?!\d))", false);
        assert_eq!(group.replace("1234567", true, |_| ",".into()), "1,234,567");
        let figure = Regex::new(r"(?<![\w.])(\d[\d,]*\.\d+)(?![\w.])", false);
        assert_eq!(
            figure.replace("sent 1.23456 and v1.5", true, |_| "X".into()),
            "sent X and v1.5"
        );
        let verb = Regex::new(r"^(?:send|sent)\b\s*", true);
        assert_eq!(
            verb.replace("SENT 5 STRK", false, |_| String::new()),
            "5 STRK"
        );
        let other = Regex::new(r"\b(?:into|to)\s+(?!this account\b)\S", false);
        assert!(other.is_match("shield 5 strk to 0xabc"));
        assert!(!other.is_match("unshield 5 strk to this account"));
        let pair = Regex::new(
            r"\bswap(?:ped|ping)?\s+~?[\d.,]*\s*([a-z0-9.$-]+)\s+for\s+(?:(?:at\s+least|~)\s*)?[\d.,]*\s*([a-z0-9.$-]+)",
            true,
        );
        let caps = pair.captures("Swap 1 STRK for ~2.5 USDC via AVNU").unwrap();
        assert_eq!(caps[1].as_deref(), Some("STRK"));
        assert_eq!(caps[2].as_deref(), Some("USDC"));
        assert!(!Regex::new("a.b", false).is_match("a\nb"));
    }
}
