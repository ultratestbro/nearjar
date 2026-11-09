//! Dev helper: prints a signed NearJar action (MultiPayload JSON) for the relayer to submit.
//! usage: cargo run --example sign -- <ed25519|erc191> <seed-byte> <verifying_contract> '<action json>'
//! The signer id is derived from the key, as near.com does for implicit accounts.

use ed25519_dalek::{Signer, SigningKey};
use sha3::{Digest, Keccak256};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (scheme, seed, contract, action) =
        (&args[1], args[2].parse::<u8>().unwrap(), &args[3], &args[4]);
    let action: serde_json::Value = serde_json::from_str(action).unwrap();
    let deadline = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + 600;
    let nonce: [u8; 32] =
        std::array::from_fn(|i| (deadline as u8).wrapping_add(i as u8).wrapping_mul(seed));

    let (signer_id, sign): (String, Box<dyn Fn(&str) -> serde_json::Value>) = match scheme.as_str()
    {
        "ed25519" => {
            let key = SigningKey::from_bytes(&[seed; 32]);
            let pk = key.verifying_key();
            (
                hex::encode(pk.as_bytes()),
                Box::new(move |payload: &str| {
                    serde_json::json!({
                        "standard": "raw_ed25519",
                        "payload": payload,
                        "public_key": format!("ed25519:{}", bs58::encode(pk.as_bytes()).into_string()),
                        "signature": format!("ed25519:{}", bs58::encode(key.sign(payload.as_bytes()).to_bytes()).into_string()),
                    })
                }),
            )
        }
        "erc191" => {
            let key = k256::ecdsa::SigningKey::from_bytes(&[seed; 32].into()).unwrap();
            let point = key.verifying_key().to_encoded_point(false);
            let addr = format!(
                "0x{}",
                hex::encode(&Keccak256::digest(&point.as_bytes()[1..])[12..])
            );
            (
                addr,
                Box::new(move |payload: &str| {
                    let prehash = Keccak256::new_with_prefix(b"\x19Ethereum Signed Message:\n")
                        .chain_update(payload.len().to_string())
                        .chain_update(payload)
                        .finalize();
                    let (sig, rid) = key.sign_prehash_recoverable(&prehash).unwrap();
                    let mut bytes = sig.to_bytes().to_vec();
                    bytes.push(rid.to_byte());
                    serde_json::json!({
                        "standard": "erc191",
                        "payload": payload,
                        "signature": format!("secp256k1:{}", bs58::encode(bytes).into_string()),
                    })
                }),
            )
        }
        other => panic!("unknown scheme {other}"),
    };

    let mut env = serde_json::json!({
        "signer_id": signer_id,
        "verifying_contract": contract,
        "deadline": format_rfc3339(deadline),
        "nonce": near_sdk::base64::Engine::encode(&near_sdk::base64::engine::general_purpose::STANDARD, nonce),
    });
    for (k, v) in action.as_object().unwrap() {
        env[k] = v.clone();
    }
    let signed = sign(&env.to_string());
    eprintln!("signer_id: {signer_id}");
    println!("{}", serde_json::json!({ "signed": signed }));
}

fn format_rfc3339(secs: u64) -> String {
    let days = secs / 86_400;
    let (h, m, s) = (secs % 86_400 / 3600, secs % 3600 / 60, secs % 60);
    // civil-from-days (Howard Hinnant)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(mo <= 2);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{m:02}:{s:02}Z")
}
