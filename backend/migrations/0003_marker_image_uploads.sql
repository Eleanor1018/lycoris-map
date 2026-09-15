-- Private, bounded staging bytes and durable completion receipts. Existing upload routes stay compatible.
CREATE TABLE marker_image_uploads (
    upload_id uuid PRIMARY KEY,
    owner_public_id uuid NOT NULL,
    marker_id bigint NOT NULL,
    client_request_id uuid NOT NULL,
    total_bytes integer NOT NULL CHECK (total_bytes BETWEEN 1 AND 5242880),
    sha256 varchar(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    received_bytes integer NOT NULL DEFAULT 0 CHECK (received_bytes >= 0 AND received_bytes <= total_bytes),
    staged_bytes bytea NOT NULL DEFAULT ''::bytea,
    status varchar(12) NOT NULL DEFAULT 'UPLOADING' CHECK (status IN ('UPLOADING', 'COMPLETED', 'EXPIRED')),
    proposal_id bigint,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
    UNIQUE (owner_public_id, client_request_id),
    CHECK ((status = 'UPLOADING' AND octet_length(staged_bytes) = received_bytes)
        OR (status <> 'UPLOADING' AND octet_length(staged_bytes) = 0)),
    CHECK ((status = 'COMPLETED' AND proposal_id IS NOT NULL AND received_bytes = total_bytes)
        OR (status <> 'COMPLETED' AND proposal_id IS NULL))
);
CREATE INDEX marker_image_uploads_owner_active ON marker_image_uploads (owner_public_id, expires_at)
    WHERE status = 'UPLOADING';
CREATE INDEX marker_image_uploads_expiry ON marker_image_uploads (expires_at) WHERE status = 'UPLOADING';
