package com.zhanibekakhmetov.temelo.server.share;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.regex.Pattern;

/**
 * Share ids: 128 random bits, written as 22 URL-safe Base64 characters.
 *
 * <p>With no accounts, knowing the id is the only thing that grants access to
 * a shared timetable, so it has to be impossible to guess or enumerate rather
 * than merely unique. 128 bits from {@link SecureRandom} is the same strength
 * as a random UUID, in a shorter form for a link.
 */
final class ShareIds {

	static final int LENGTH = 22;

	private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9_-]{" + LENGTH + "}");

	private static final SecureRandom RANDOM = new SecureRandom();

	private static final Base64.Encoder ENCODER = Base64.getUrlEncoder().withoutPadding();

	private ShareIds() {
	}

	static String next() {
		byte[] bytes = new byte[16];
		RANDOM.nextBytes(bytes);
		return ENCODER.encodeToString(bytes);
	}

	/** Whether {@code id} could be a share id at all — checked before any query. */
	static boolean isWellFormed(String id) {
		return id != null && FORMAT.matcher(id).matches();
	}

}
