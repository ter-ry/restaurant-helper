from __future__ import annotations

from cryptography.fernet import Fernet

from backend.square import decrypt_square_secret, encrypt_square_secret, square_notification_signature, verify_square_webhook_signature


def test_square_token_encryption_round_trip(app):
    with app.app_context():
        app.config.update(
            {
                "INTEGRATION_ENCRYPTION_KEY": Fernet.generate_key().decode("utf-8"),
            }
        )
        ciphertext = encrypt_square_secret("square-access-token")
        assert ciphertext != "square-access-token"
        assert decrypt_square_secret(ciphertext) == "square-access-token"


def test_square_webhook_signature_verification(app):
    body = b'{"type":"order.created","event_id":"123"}'
    notification_url = "https://example.com/webhooks/square"
    signature_key = "c2lnbmF0dXJlLWtleQ=="

    expected = square_notification_signature(body, notification_url, signature_key)
    assert verify_square_webhook_signature(
        raw_body=body,
        notification_url=notification_url,
        signature_header=expected,
        signature_key=signature_key,
    )
    assert not verify_square_webhook_signature(
        raw_body=body,
        notification_url=notification_url,
        signature_header="invalid-signature",
        signature_key=signature_key,
    )

