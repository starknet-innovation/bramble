//! A string-keyed map with JavaScript object order: keys stay in first-insertion order and a
//! re-inserted key keeps its place with the new value, as `{ ...a, [k]: v }` does. Maps here hold
//! a few dozen token addresses, so a linear scan is the simplest honest structure.

#[derive(Debug, Clone)]
pub struct OrderedMap<V>(Vec<(String, V)>);

impl<V> Default for OrderedMap<V> {
    fn default() -> Self {
        Self(Vec::new())
    }
}

impl<V> OrderedMap<V> {
    pub fn from_entries(entries: Vec<(String, V)>) -> Self {
        let mut map = Self::default();
        for (key, value) in entries {
            map.insert(key, value);
        }
        map
    }

    pub fn get(&self, key: &str) -> Option<&V> {
        self.0.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }

    pub fn insert(&mut self, key: String, value: V) {
        match self.0.iter_mut().find(|(k, _)| *k == key) {
            Some(slot) => slot.1 = value,
            None => self.0.push((key, value)),
        }
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn entries(&self) -> &[(String, V)] {
        &self.0
    }

    pub fn into_entries(self) -> Vec<(String, V)> {
        self.0
    }
}
