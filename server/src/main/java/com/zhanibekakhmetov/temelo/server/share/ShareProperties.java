package com.zhanibekakhmetov.temelo.server.share;

import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.util.unit.DataSize;

/**
 * Settings for shared timetables, under {@code temelo.share.*}.
 *
 * @param ttl how long a link works after it is created
 * @param maxSize the largest upload accepted, in bytes of the request body. A
 * real {@code .temelo} file is a few kilobytes and the largest the app can
 * produce is a few tens of kilobytes, so the default leaves ample room while
 * keeping one request from taking a meaningful share of a small database.
 */
@ConfigurationProperties("temelo.share")
public record ShareProperties(@DefaultValue("14d") Duration ttl, @DefaultValue("1MB") DataSize maxSize) {

	public ShareProperties {
		if (ttl.isNegative() || ttl.isZero()) {
			throw new IllegalArgumentException("temelo.share.ttl must be positive, was " + ttl);
		}
		if (maxSize.toBytes() <= 0 || maxSize.toBytes() >= Integer.MAX_VALUE) {
			throw new IllegalArgumentException("temelo.share.max-size must be between 1 byte and 2 GB, was " + maxSize);
		}
	}

}
