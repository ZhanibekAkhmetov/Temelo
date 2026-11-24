-- Timetables shared as links (milestone 14.5).
--
-- One row per shared .temelo file. There are no accounts: the random id is the
-- only thing that grants access, and a row stops being served once it expires
-- and is deleted by the hourly purge after that.
--
-- The envelope is kept as text, exactly as it was uploaded, rather than as
-- jsonb: the server never queries inside a timetable, and a link must hand
-- back the very file that was shared, not PostgreSQL's re-serialisation of it.

CREATE TABLE shared_timetables (
    id          varchar(22)  PRIMARY KEY,
    envelope    text         NOT NULL,
    size_bytes  integer      NOT NULL,
    created_at  timestamptz  NOT NULL,
    expires_at  timestamptz  NOT NULL,
    CONSTRAINT shared_timetables_size_positive CHECK (size_bytes > 0),
    CONSTRAINT shared_timetables_expiry_after_creation CHECK (expires_at > created_at)
);

-- The purge deletes by expiry, and every read filters on it.
CREATE INDEX shared_timetables_expires_at_idx ON shared_timetables (expires_at);
