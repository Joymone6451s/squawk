//! A tiny writer for near.social (the `social-kv/1` standard on FastData KV).
//!
//! near.social stores every post, like and follow as a function call named `__fastdata_kv`,
//! sent to the account `social`. Nothing runs there: the account has no contract, and an indexer
//! reads the call's arguments off the chain. The author of a write is the predecessor of the
//! *receipt*, and a receipt made by a smart contract looks the same as one made by a wallet.
//!
//! So a contract can be a near.social account with no keys at all. This module is everything it
//! takes. It holds no state, needs no callback, and nothing in it is specific to SQUAWK: copy the
//! file into any NEAR contract to give that contract a voice.
//!
//! ```ignore
//! Batch::new()
//!     .post(env::block_timestamp_ms(), "gm from a contract")
//!     .follow(&"alice.near".parse().unwrap())
//!     .send(&"social".parse().unwrap());
//! ```
//!
//! The receipt always fails with `CodeDoesNotExist`. That is how near.social works, and it is why
//! [`Batch::send`] detaches the promise instead of waiting on it.

use near_sdk::serde_json::{Map, Value, json};
use near_sdk::{AccountId, Gas, NearToken, Promise};

/// The method the FastData indexer watches for.
pub const METHOD: &str = "__fastdata_kv";
/// The receiving side does no work, so the call carries the smallest gas a function call may.
pub const GAS: Gas = Gas::from_gas(1);
/// 2^53 - 1, the largest post id the standard allows.
pub const MAX_POST_ID: u64 = 9_007_199_254_740_991;
/// FastData drops a whole call that carries more keys than this.
pub const MAX_KEYS: usize = 256;

/// A near.social post, `"{account_id}/{post_id}"`, checked against the standard.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PostRef {
    pub author: AccountId,
    pub id: u64,
}

impl PostRef {
    /// Parses and validates a reference. The account must be a valid NEAR account id and the post
    /// id a decimal integer in `1..=2^53-1` with no leading zero, exactly as the standard says.
    pub fn parse(text: &str) -> Result<Self, &'static str> {
        let (author, id) = text.split_once('/').ok_or("a post looks like account.near/1759140000000")?;
        if id.is_empty() || id.len() > 16 || id.starts_with('0') || !id.bytes().all(|b| b.is_ascii_digit()) {
            return Err("the post id must be a whole number with no leading zero");
        }
        let id: u64 = id.parse().map_err(|_| "the post id is too large")?;
        if id > MAX_POST_ID {
            return Err("the post id is too large");
        }
        let author: AccountId = author.parse().map_err(|_| "the part before the slash is not a NEAR account")?;
        Ok(Self { author, id })
    }

    /// The canonical `"{account_id}/{post_id}"` form.
    pub fn key(&self) -> String {
        format!("{}/{}", self.author, self.id)
    }
}

/// One `__fastdata_kv` call: a set of keys written together. Values are escaped by `serde_json`,
/// so text passed in can never break out of its field.
#[derive(Default, Debug, Clone)]
pub struct Batch(Map<String, Value>);

impl Batch {
    pub fn new() -> Self {
        Self::default()
    }

    /// A top-level post. `id` should be the current Unix time in milliseconds.
    pub fn post(mut self, id: u64, text: &str) -> Self {
        self.0.insert(format!("post/{id}"), json!({ "text": text }));
        self
    }

    /// A post that quotes another post.
    pub fn quote(mut self, id: u64, text: &str, quoted: &PostRef) -> Self {
        self.0.insert(format!("post/{id}"), json!({ "text": text, "quote": quoted.key() }));
        self
    }

    /// A reply, with the backlink the standard asks for. `root` is the top of the thread.
    pub fn reply(mut self, id: u64, text: &str, parent: &PostRef, root: &PostRef) -> Self {
        self.0.insert(
            format!("post/{id}"),
            json!({ "text": text, "reply_to": parent.key(), "root": root.key() }),
        );
        self.0.insert(format!("reply/{}/{id}", parent.key()), json!({}));
        self
    }

    pub fn like(mut self, post: &PostRef) -> Self {
        self.0.insert(format!("like/{}", post.key()), json!({}));
        self
    }

    pub fn repost(mut self, post: &PostRef) -> Self {
        self.0.insert(format!("repost/{}", post.key()), json!({}));
        self
    }

    pub fn follow(mut self, account: &AccountId) -> Self {
        self.0.insert(format!("graph/follow/{account}"), json!({}));
        self
    }

    /// One profile field: `name`, `about`, `avatar`, `banner`, `location` or `links/{service}`.
    pub fn profile(mut self, field: &str, value: &str) -> Self {
        self.0.insert(format!("profile/{field}"), Value::String(value.to_string()));
        self
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }

    /// The JSON object sent as the call's arguments.
    pub fn to_json(&self) -> String {
        Value::Object(self.0.clone()).to_string()
    }

    /// Sends the batch as one receipt to `social`. Nothing is sent for an empty batch.
    pub fn send(self, social: &AccountId) {
        if self.0.is_empty() {
            return;
        }
        assert!(self.0.len() <= MAX_KEYS, "a near.social call holds at most 256 keys");
        Promise::new(social.clone())
            .function_call(METHOD, self.to_json().into_bytes(), NearToken::from_yoctonear(0), GAS)
            .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_what_the_standard_accepts() {
        let p = PostRef::parse("alice.near/1759140000000").unwrap();
        assert_eq!(p.author.as_str(), "alice.near");
        assert_eq!(p.id, 1_759_140_000_000);
        assert_eq!(p.key(), "alice.near/1759140000000");
        assert!(PostRef::parse("social/1").is_ok());
        assert!(PostRef::parse(&format!("{}/9007199254740991", "a".repeat(64))).is_ok());
        assert!(PostRef::parse("51b720e4ec5c4daf1315b1ffffaae8389102a1e5401b3f2ed5827e08fead5acf/1794353073123").is_ok());
    }

    #[test]
    fn rejects_everything_else() {
        for bad in [
            "",
            "alice.near",
            "alice.near/",
            "/123",
            "alice.near/0",
            "alice.near/0123",
            "alice.near/12a",
            "alice.near/-1",
            "alice.near/+1",
            "alice.near/1.5",
            "alice.near/ 1",
            "alice.near/9007199254740992",
            "alice.near/99999999999999999",
            "Alice.near/1",
            "a/1",
            "alice..near/1",
            "alice.near/1/2",
            "alice.near\"/1",
            "alice near/1",
            "https://near.social/alice.near/post/1",
        ] {
            assert!(PostRef::parse(bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn text_cannot_break_out_of_its_field() {
        let nasty = "\"},\"graph/follow/evil.near\":{},\"x\":{\"y\":\"\\";
        let json = Batch::new().post(5, nasty).to_json();
        let parsed: Value = near_sdk::serde_json::from_str(&json).unwrap();
        let object = parsed.as_object().unwrap();
        assert_eq!(object.len(), 1, "only the post key exists");
        assert_eq!(object["post/5"]["text"], nasty);
    }

    #[test]
    fn builds_every_kind_of_write() {
        let alice = PostRef::parse("alice.near/100").unwrap();
        let root = PostRef::parse("bob.near/50").unwrap();
        let batch = Batch::new()
            .quote(7, "look", &alice)
            .like(&alice)
            .repost(&alice)
            .follow(&alice.author)
            .profile("about", "hello")
            .profile("links/website", "https://example.com");
        let v: Value = near_sdk::serde_json::from_str(&batch.to_json()).unwrap();
        assert_eq!(v["post/7"]["quote"], "alice.near/100");
        assert_eq!(v["post/7"]["text"], "look");
        assert_eq!(v["like/alice.near/100"], json!({}));
        assert_eq!(v["repost/alice.near/100"], json!({}));
        assert_eq!(v["graph/follow/alice.near"], json!({}));
        assert_eq!(v["profile/about"], "hello");
        assert_eq!(v["profile/links/website"], "https://example.com");
        assert_eq!(batch.len(), 6);

        let reply = Batch::new().reply(9, "agreed", &alice, &root);
        let v: Value = near_sdk::serde_json::from_str(&reply.to_json()).unwrap();
        assert_eq!(v["post/9"]["reply_to"], "alice.near/100");
        assert_eq!(v["post/9"]["root"], "bob.near/50");
        assert_eq!(v["reply/alice.near/100/9"], json!({}));
    }
}
