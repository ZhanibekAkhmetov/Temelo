package com.zhanibekakhmetov.temelo.server.share;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.PostLoad;
import jakarta.persistence.PostPersist;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;

import org.springframework.data.domain.Persistable;

/**
 * A {@code .temelo} file shared as a link — a row of {@code shared_timetables}
 * (see {@code V1__create_shared_timetables.sql}).
 *
 * <p>Immutable once stored: a share is created and later deleted, never edited.
 * The id is assigned here rather than by the database, so the entity reports
 * itself as new until it has been persisted; otherwise Spring Data would take
 * the assigned id to mean "existing" and issue a pointless SELECT before the
 * INSERT.
 */
@Entity
@Table(name = "shared_timetables")
class SharedTimetable implements Persistable<String> {

	@Id
	@Column(length = 22)
	private String id;

	@Column(nullable = false, columnDefinition = "text")
	private String envelope;

	@Column(name = "size_bytes", nullable = false)
	private int sizeBytes;

	@Column(name = "created_at", nullable = false)
	private Instant createdAt;

	@Column(name = "expires_at", nullable = false)
	private Instant expiresAt;

	@Transient
	private boolean isNew = true;

	protected SharedTimetable() {
	}

	SharedTimetable(String id, String envelope, int sizeBytes, Instant createdAt, Instant expiresAt) {
		this.id = id;
		this.envelope = envelope;
		this.sizeBytes = sizeBytes;
		this.createdAt = createdAt;
		this.expiresAt = expiresAt;
	}

	@Override
	public String getId() {
		return this.id;
	}

	String getEnvelope() {
		return this.envelope;
	}

	int getSizeBytes() {
		return this.sizeBytes;
	}

	Instant getCreatedAt() {
		return this.createdAt;
	}

	Instant getExpiresAt() {
		return this.expiresAt;
	}

	@Override
	public boolean isNew() {
		return this.isNew;
	}

	@PostLoad
	@PostPersist
	void markNotNew() {
		this.isNew = false;
	}

}
