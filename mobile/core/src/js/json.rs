//! A bounded reader for untrusted JSON with `JSON.parse` semantics where the output depends on
//! them: every number keeps its raw text and is converted with `str::parse::<f64>` (correctly
//! rounded, as JavaScript; an overflowing literal becomes ±Infinity instead of failing the whole
//! body), duplicate keys resolve last-wins, and a leading UTF-8 BOM is dropped as `TextDecoder`
//! drops it. serde_json's default float parser is best-effort and may be one ULP off, which can
//! flip a half-cent rounding, so it never reads a number whose value reaches the screen.

/// Nesting deeper than this is refused (JavaScript would recurse further; no real body nests).
const MAX_DEPTH: usize = 128;

/// A parsed JSON value.
#[derive(Debug, Clone, PartialEq)]
pub enum JsValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    Array(Vec<JsValue>),
    /// Keys in first-insertion order, each holding its last value.
    Object(Vec<(String, JsValue)>),
}

impl JsValue {
    /// A property of an object (`undefined` → `None`, also for non-objects).
    pub fn get(&self, key: &str) -> Option<&JsValue> {
        match self {
            Self::Object(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Self::Number(value) => Some(*value),
            _ => None,
        }
    }

    pub fn as_array(&self) -> Option<&[JsValue]> {
        match self {
            Self::Array(items) => Some(items),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(String, JsValue)]> {
        match self {
            Self::Object(entries) => Some(entries),
            _ => None,
        }
    }

    /// Serialises back to JSON text (numbers in JavaScript's own spelling).
    pub fn to_json(&self) -> String {
        match self {
            Self::Null => "null".into(),
            Self::Bool(value) => value.to_string(),
            Self::Number(value) if value.is_finite() => super::num::number_to_string(*value),
            Self::Number(_) => "null".into(),
            Self::String(value) => serde_json::Value::String(value.clone()).to_string(),
            Self::Array(items) => format!(
                "[{}]",
                items
                    .iter()
                    .map(Self::to_json)
                    .collect::<Vec<_>>()
                    .join(",")
            ),
            Self::Object(entries) => format!(
                "{{{}}}",
                entries
                    .iter()
                    .map(|(k, v)| format!(
                        "{}:{}",
                        serde_json::Value::String(k.clone()),
                        v.to_json()
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            ),
        }
    }
}

/// Decodes response bytes as `TextDecoder("utf-8")` does: BOM dropped, invalid sequences replaced.
pub fn decode_utf8(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    String::from_utf8_lossy(bytes).into_owned()
}

/// `JSON.parse(text)`; `None` where it would throw (or nests deeper than the bound).
pub fn parse(text: &str) -> Option<JsValue> {
    let mut parser = Parser {
        chars: text.as_bytes(),
        pos: 0,
    };
    parser.skip_ws();
    let value = parser.value(0)?;
    parser.skip_ws();
    (parser.pos == parser.chars.len()).then_some(value)
}

// Works on the UTF-8 bytes: every structural character is ASCII, and string contents are copied
// through byte-for-byte, so a 32 MiB event page costs 32 MiB rather than four times that.
struct Parser<'a> {
    chars: &'a [u8],
    pos: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.pos).map(|b| char::from(*b))
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.pos += 1;
        }
    }

    fn literal(&mut self, word: &str, value: JsValue) -> Option<JsValue> {
        for expected in word.chars() {
            if self.peek()? != expected {
                return None;
            }
            self.pos += 1;
        }
        Some(value)
    }

    fn value(&mut self, depth: usize) -> Option<JsValue> {
        if depth > MAX_DEPTH {
            return None;
        }
        match self.peek()? {
            '{' => self.object(depth),
            '[' => self.array(depth),
            '"' => self.string().map(JsValue::String),
            't' => self.literal("true", JsValue::Bool(true)),
            'f' => self.literal("false", JsValue::Bool(false)),
            'n' => self.literal("null", JsValue::Null),
            _ => self.number(),
        }
    }

    fn object(&mut self, depth: usize) -> Option<JsValue> {
        self.pos += 1;
        let mut entries: Vec<(String, JsValue)> = Vec::new();
        let mut index: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        self.skip_ws();
        if self.peek()? == '}' {
            self.pos += 1;
            return Some(JsValue::Object(entries));
        }
        loop {
            self.skip_ws();
            if self.peek()? != '"' {
                return None;
            }
            let key = self.string()?;
            self.skip_ws();
            if self.peek()? != ':' {
                return None;
            }
            self.pos += 1;
            self.skip_ws();
            let value = self.value(depth + 1)?;
            match index.get(&key) {
                Some(slot) => entries[*slot].1 = value,
                None => {
                    index.insert(key.clone(), entries.len());
                    entries.push((key, value));
                }
            }
            self.skip_ws();
            match self.peek()? {
                ',' => self.pos += 1,
                '}' => {
                    self.pos += 1;
                    return Some(JsValue::Object(entries));
                }
                _ => return None,
            }
        }
    }

    fn array(&mut self, depth: usize) -> Option<JsValue> {
        self.pos += 1;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek()? == ']' {
            self.pos += 1;
            return Some(JsValue::Array(items));
        }
        loop {
            self.skip_ws();
            items.push(self.value(depth + 1)?);
            self.skip_ws();
            match self.peek()? {
                ',' => self.pos += 1,
                ']' => {
                    self.pos += 1;
                    return Some(JsValue::Array(items));
                }
                _ => return None,
            }
        }
    }

    fn hex4(&mut self) -> Option<u32> {
        let mut value = 0;
        for _ in 0..4 {
            value = value * 16 + self.peek()?.to_digit(16)?;
            self.pos += 1;
        }
        Some(value)
    }

    fn string(&mut self) -> Option<String> {
        self.pos += 1;
        let mut out: Vec<u8> = Vec::new();
        let push = |out: &mut Vec<u8>, c: char| {
            let mut buffer = [0u8; 4];
            out.extend_from_slice(c.encode_utf8(&mut buffer).as_bytes());
        };
        loop {
            let byte = *self.chars.get(self.pos)?;
            self.pos += 1;
            match byte {
                b'"' => return String::from_utf8(out).ok(),
                b'\\' => {
                    let escape = self.peek()?;
                    self.pos += 1;
                    let c = match escape {
                        '"' => '"',
                        '\\' => '\\',
                        '/' => '/',
                        'b' => '\u{8}',
                        'f' => '\u{c}',
                        'n' => '\n',
                        'r' => '\r',
                        't' => '\t',
                        'u' => self.unicode_escape()?,
                        _ => return None,
                    };
                    push(&mut out, c);
                }
                byte if byte < 0x20 => return None,
                byte => out.push(byte),
            }
        }
    }

    // A `\uXXXX` escape, joining a surrogate pair. A lone surrogate, which JavaScript keeps as an
    // unpaired code unit, becomes U+FFFD: it has no Rust `String` spelling, and every consumer of
    // these bodies validates against an ASCII grammar that rejects both alike.
    fn unicode_escape(&mut self) -> Option<char> {
        let first = self.hex4()?;
        if (0xD800..0xDC00).contains(&first) {
            let save = self.pos;
            if self.peek() == Some('\\') && self.chars.get(self.pos + 1) == Some(&b'u') {
                self.pos += 2;
                let second = self.hex4()?;
                if (0xDC00..0xE000).contains(&second) {
                    let code = 0x10000 + ((first - 0xD800) << 10) + (second - 0xDC00);
                    return char::from_u32(code);
                }
            }
            self.pos = save;
            return Some('\u{FFFD}');
        }
        Some(char::from_u32(first).unwrap_or('\u{FFFD}'))
    }

    fn number(&mut self) -> Option<JsValue> {
        let start = self.pos;
        if self.peek() == Some('-') {
            self.pos += 1;
        }
        match self.peek()? {
            '0' => self.pos += 1,
            '1'..='9' => {
                while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                    self.pos += 1;
                }
            }
            _ => return None,
        }
        if self.peek() == Some('.') {
            self.pos += 1;
            let digits = self.pos;
            while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                self.pos += 1;
            }
            if self.pos == digits {
                return None;
            }
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some('+' | '-')) {
                self.pos += 1;
            }
            let digits = self.pos;
            while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                self.pos += 1;
            }
            if self.pos == digits {
                return None;
            }
        }
        let text = std::str::from_utf8(&self.chars[start..self.pos]).ok()?;
        text.parse::<f64>().ok().map(JsValue::Number)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_numbers_from_raw_text() {
        assert_eq!(parse("1e400"), Some(JsValue::Number(f64::INFINITY)));
        assert_eq!(parse("-0"), Some(JsValue::Number(-0.0)));
        for bad in ["01", "1.", ".5", "+1", "NaN", "0x10", "1e"] {
            assert_eq!(parse(bad), None, "{bad}");
        }
    }

    #[test]
    fn objects_are_last_wins() {
        let value = parse(r#"{"a":1,"b":2,"a":3}"#).unwrap();
        assert_eq!(value.get("a"), Some(&JsValue::Number(3.0)));
        assert_eq!(value.as_object().unwrap()[0].0, "a");
    }

    #[test]
    fn strings_and_bounds() {
        assert_eq!(
            parse(r#""é😀\ud800x""#),
            Some(JsValue::String("é😀\u{FFFD}x".into()))
        );
        assert_eq!(parse("\"a\nb\""), None);
        assert_eq!(parse(&"[".repeat(200)), None);
        assert_eq!(decode_utf8(b"\xEF\xBB\xBF{}"), "{}");
        assert_eq!(parse(" { } "), Some(JsValue::Object(Vec::new())));
    }
}
