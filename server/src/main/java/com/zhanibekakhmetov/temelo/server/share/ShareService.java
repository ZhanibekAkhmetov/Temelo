package com.zhanibekakhmetov.temelo.server.share;

import java.time.Clock;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creating, reading and expiring shared timetables.
 */
@Service
class ShareService {

	private final SharedTimetableRepository repository;

	private final TemeloEnvelopeValidator validator;

	private final ShareProperties properties;

	private final Clock clock;

	ShareService(SharedTimetableRepository repository, TemeloEnvelopeValidator validator, ShareProperties properties,
			Clock clock) {
		this.repository = repository;
		this.validator = validator;
		this.properties = properties;
		this.clock = clock;
	}

	/**
	 * Stores an uploaded {@code .temelo} file and returns the new share.
	 * @param body the request body, at most {@code temelo.share.max-size} bytes
	 * @throws EnvelopeRejectedException if it is not a storable Temelo file;
	 * nothing is written then
	 */
	@Transactional
	SharedTimetable create(byte[] body) {
		String envelope = this.validator.check(body);
		// Milliseconds: what PostgreSQL stores exactly and what a JavaScript Date
		// reads exactly, so the expiry the client is told is the stored one.
		Instant now = this.clock.instant().truncatedTo(ChronoUnit.MILLIS);
		SharedTimetable share = new SharedTimetable(ShareIds.next(), envelope, body.length, now,
				now.plus(this.properties.ttl()));
		return this.repository.save(share);
	}

	/**
	 * The file shared under {@code id}, exactly as it was uploaded — empty when
	 * there is no such share or it has expired, which callers do not tell apart.
	 */
	@Transactional(readOnly = true)
	Optional<String> findEnvelope(String id) {
		if (!ShareIds.isWellFormed(id)) {
			return Optional.empty();
		}
		return this.repository.findByIdAndExpiresAtAfter(id, this.clock.instant()).map(SharedTimetable::getEnvelope);
	}

	/** Deletes every expired share and returns how many there were. */
	@Transactional
	int purgeExpired() {
		return this.repository.deleteExpired(this.clock.instant());
	}

}
