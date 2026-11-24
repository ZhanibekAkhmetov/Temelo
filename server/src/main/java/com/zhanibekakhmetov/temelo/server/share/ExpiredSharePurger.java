package com.zhanibekakhmetov.temelo.server.share;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Deletes expired shares from the database.
 *
 * <p>Expiry itself does not depend on this: a read already ignores an expired
 * share. The purge only stops expired files from taking up space. On a host
 * that suspends an idle server it simply runs less often, which costs storage
 * and nothing else.
 */
@Component
class ExpiredSharePurger {

	private static final Logger log = LoggerFactory.getLogger(ExpiredSharePurger.class);

	private final ShareService shares;

	ExpiredSharePurger(ShareService shares) {
		this.shares = shares;
	}

	@Scheduled(initialDelayString = "${temelo.share.purge-initial-delay:PT1M}",
			fixedDelayString = "${temelo.share.purge-interval:PT1H}")
	void purge() {
		int deleted = this.shares.purgeExpired();
		if (deleted > 0) {
			log.info("Deleted {} expired shared timetable(s)", deleted);
		}
	}

}
