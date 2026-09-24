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
//!
//! Inputs are not constants: summaries and figures come from explorer and price responses. A
//! backtracking matcher can take exponential time on a hostile input, so every search has a hard
//! budget of `STEP_BUDGET` matcher steps. A search that exhausts it fails as a whole (no match,
//! `Err(Exhausted)` from `try_find_at`), which every caller treats as input that did not validate:
//! it is never classified, reformatted, or accepted on a partial search.

use std::cell::Cell;

use super::num::is_js_whitespace;
use parse::Compiler;

#[path = "regex_parse.rs"]
mod parse;

/// Matcher steps one search may take before it is abandoned. The extension's patterns over a
/// 200-character summary take a few thousand; this leaves two orders of magnitude of headroom
/// while bounding a hostile input to milliseconds.
pub const STEP_BUDGET: u32 = 300_000;
/// Deepest nesting of matcher calls one search may reach. The matcher recurses once per consumed
/// character (continuation passing), so a long hostile input would otherwise overflow the stack
/// long before the step budget runs out; past this depth the search is abandoned the same way.
pub const DEPTH_BUDGET: u32 = 1_500;

/// A search ran out of `STEP_BUDGET` before it could decide.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Exhausted;

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

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn is_line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

struct Matcher<'a> {
    input: &'a [char],
    ignore_case: bool,
    /// Steps taken by this search; past `STEP_BUDGET` every branch fails.
    steps: Cell<u32>,
    /// Current nesting of `seq`; past `DEPTH_BUDGET` the search is abandoned.
    depth: Cell<u32>,
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

    /// Counts one step; `false` once the search is over budget.
    fn step(&self) -> bool {
        let taken = self.steps.get().saturating_add(1);
        self.steps.set(taken);
        taken <= STEP_BUDGET
    }

    fn exhausted(&self) -> bool {
        self.steps.get() > STEP_BUDGET
    }

    /// Abandons the whole search (as if the step budget ran out).
    fn abandon(&self) {
        self.steps.set(STEP_BUDGET.saturating_add(1));
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
        if !self.step() {
            return false;
        }
        let depth = self.depth.get() + 1;
        if depth > DEPTH_BUDGET {
            self.abandon();
            return false;
        }
        self.depth.set(depth);
        let matched = self.seq_step(seq, pos, caps, k);
        self.depth.set(depth - 1);
        matched
    }

    fn seq_step(
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

    /// Leftmost match starting at or after `from` (`RegExp.prototype.exec` with `lastIndex`);
    /// `None` when there is none or the search exhausted its budget (see `try_find_at`).
    pub fn find_at(&self, input: &[char], from: usize) -> Option<Match> {
        self.try_find_at(input, from).ok().flatten()
    }

    /// `find_at`, distinguishing a search that ran out of `STEP_BUDGET` (`Err(Exhausted)`) from
    /// one that found no match. The budget covers the whole leftmost search, every start included.
    pub fn try_find_at(&self, input: &[char], from: usize) -> Result<Option<Match>, Exhausted> {
        let matcher = Matcher {
            input,
            ignore_case: self.ignore_case,
            steps: Cell::new(0),
            depth: Cell::new(0),
        };
        for start in from..=input.len() {
            let mut caps: Caps = vec![None; self.groups + 1];
            let mut end = None;
            let found = matcher.alts(&self.root, start, &mut caps, &mut |p, _| {
                end = Some(p);
                true
            });
            if matcher.exhausted() {
                return Err(Exhausted);
            }
            if found {
                let end = end.expect("a match records its end");
                caps[0] = Some((start, end));
                return Ok(Some(Match {
                    start,
                    end,
                    captures: caps,
                }));
            }
        }
        Ok(None)
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
#[path = "regex_tests.rs"]
mod tests;
