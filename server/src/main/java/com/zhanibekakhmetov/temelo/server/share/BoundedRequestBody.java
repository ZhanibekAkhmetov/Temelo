package com.zhanibekakhmetov.temelo.server.share;

import java.io.IOException;
import java.io.InputStream;

import jakarta.servlet.http.HttpServletRequest;

import com.zhanibekakhmetov.temelo.server.share.EnvelopeRejectedException.Reason;

/**
 * Reads a request body that may not exceed a limit.
 *
 * <p>Refused as early as possible: up front from Content-Length when the
 * client sent one, and otherwise — a chunked upload has none — while reading,
 * after at most one byte too many, so an oversized upload is never held in
 * memory whole.
 */
final class BoundedRequestBody {

	private BoundedRequestBody() {
	}

	static byte[] read(HttpServletRequest request, int limit) throws IOException {
		if (request.getContentLengthLong() > limit) {
			throw tooLarge(limit);
		}
		try (InputStream in = request.getInputStream()) {
			byte[] body = in.readNBytes(limit + 1);
			if (body.length > limit) {
				throw tooLarge(limit);
			}
			return body;
		}
	}

	private static EnvelopeRejectedException tooLarge(int limit) {
		return new EnvelopeRejectedException(Reason.TOO_LARGE,
				"The body is larger than " + limit + " bytes, the most this server accepts.");
	}

}
