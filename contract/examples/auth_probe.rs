//! Dev probe: a 1Click User-Session sign-in payload (empty intent, versioned nonce) for a throwaway
//! ed25519 key. usage: cargo run --example auth_probe -- <seed-byte> <salt-hex>
use defuse_core::{ExpirableNonce, Nonce, Salt, SaltedNonce, Timestamp, VersionedNonce};
use ed25519_dalek::{Signer, SigningKey};

fn main() {
    let seed: u8 = std::env::args().nth(1).unwrap().parse().unwrap();
    let key = SigningKey::from_bytes(&[seed; 32]);
    let pk = key.verifying_key();
    let signer_id = hex::encode(pk.as_bytes());
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap();
    // the nonce carries the deadline too: payload deadline <= nonce deadline, and 1Click wants it within 5 min of now
    let deadline_ns = (now.as_secs() as i128 + 240) * 1_000_000_000;
    // 1Click reads the sign-in time from the first 8 "random" bytes (i64 ns, little-endian), as the
    // intents SDK's createTimestampedNonceBytes writes it
    let mut random: [u8; 15] = std::array::from_fn(|i| (now.subsec_nanos() as u8).wrapping_add((i as u8).wrapping_mul(31)));
    random[..8].copy_from_slice(&(now.as_nanos() as i64).to_le_bytes());
    let nonce: Nonce = VersionedNonce::V1(SaltedNonce::new(
        std::env::args().nth(2).expect("salt hex from intents.near current_salt").parse::<Salt>().unwrap(),
        ExpirableNonce::new(Timestamp::from_nanos(deadline_ns).unwrap(), random),
    ))
    .into();
    let deadline = Timestamp::from_nanos(deadline_ns).unwrap();
    let payload = serde_json::json!({
        "signer_id": signer_id,
        "verifying_contract": "intents.near",
        "deadline": deadline.to_string(),
        "nonce": near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, nonce),
        "intents": [],
    })
    .to_string();
    let sig = key.sign(payload.as_bytes());
    eprintln!("signer_id: {signer_id}");
    println!("{}", serde_json::json!({ "signedData": {
        "standard": "raw_ed25519",
        "payload": payload,
        "public_key": format!("ed25519:{}", bs58::encode(pk.as_bytes()).into_string()),
        "signature": format!("ed25519:{}", bs58::encode(sig.to_bytes()).into_string()),
    }}));
}
