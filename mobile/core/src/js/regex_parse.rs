//! The pattern compiler for `regex.rs` (kept apart to hold it under 500 lines): the supported
//! JavaScript syntax into `Node` trees. Patterns are constants; unsupported syntax panics in tests.

use super::{ClassItem, Node};

pub(super) struct Compiler<'p> {
    pub(super) chars: Vec<char>,
    pub(super) pos: usize,
    pub(super) groups: usize,
    pub(super) _pattern: &'p str,
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

    pub(super) fn disjunction(&mut self) -> Vec<Vec<Node>> {
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
