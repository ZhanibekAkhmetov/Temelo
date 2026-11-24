package com.zhanibekakhmetov.temelo.server.share;

import org.springframework.http.HttpStatus;

/**
 * An upload that is not a {@code .temelo} file the server is willing to store.
 *
 * <p>The message is safe to show to the client: it names a field of the
 * envelope or a limit, never anything from the server's side.
 */
class EnvelopeRejectedException extends RuntimeException {

	/**
	 * Why an upload was refused. The codes are part of the API: the app maps
	 * them to its own messages, so they do not change once published.
	 */
	enum Reason {

		/** More bytes, or more records, than the server accepts. */
		TOO_LARGE("too-large", HttpStatus.CONTENT_TOO_LARGE, "Shared timetable too large"),

		/** Not UTF-8 JSON, not an object, or not carrying the Temelo type. */
		NOT_TEMELO("not-temelo", HttpStatus.UNPROCESSABLE_CONTENT, "Not a Temelo timetable"),

		/** A Temelo file in an envelope version newer than this server knows. */
		UNSUPPORTED_VERSION("unsupported-version", HttpStatus.UNPROCESSABLE_CONTENT,
				"Unsupported Temelo file version"),

		/** A Temelo file whose envelope does not have the expected shape. */
		MALFORMED("malformed", HttpStatus.UNPROCESSABLE_CONTENT, "Malformed Temelo timetable");

		private final String code;

		private final HttpStatus status;

		private final String title;

		Reason(String code, HttpStatus status, String title) {
			this.code = code;
			this.status = status;
			this.title = title;
		}

		String code() {
			return this.code;
		}

		HttpStatus status() {
			return this.status;
		}

		String title() {
			return this.title;
		}

	}

	private final Reason reason;

	EnvelopeRejectedException(Reason reason, String message) {
		super(message);
		this.reason = reason;
	}

	Reason reason() {
		return this.reason;
	}

}
