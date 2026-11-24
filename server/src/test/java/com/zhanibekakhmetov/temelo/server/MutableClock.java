package com.zhanibekakhmetov.temelo.server;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** A clock a test moves by hand, to see expiry without waiting two weeks. */
public final class MutableClock extends Clock {

	private Instant now;

	public MutableClock(Instant start) {
		this.now = start;
	}

	public synchronized void advance(Duration duration) {
		this.now = this.now.plus(duration);
	}

	public synchronized void set(Instant instant) {
		this.now = instant;
	}

	@Override
	public synchronized Instant instant() {
		return this.now;
	}

	@Override
	public ZoneId getZone() {
		return ZoneOffset.UTC;
	}

	@Override
	public Clock withZone(ZoneId zone) {
		throw new UnsupportedOperationException("The server only reads instants");
	}

}
