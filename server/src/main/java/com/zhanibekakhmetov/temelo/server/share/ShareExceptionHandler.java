package com.zhanibekakhmetov.temelo.server.share;

import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * Turns refusals into RFC 9457 problem details.
 *
 * <p>Each carries a {@code reason} — a short, stable code the app maps to its
 * own localized message — beside the human-readable {@code detail}, which is
 * for logs and for someone reading the API, not for the app's users.
 */
@RestControllerAdvice(assignableTypes = ShareController.class)
class ShareExceptionHandler {

	static final String REASON = "reason";

	@ExceptionHandler(EnvelopeRejectedException.class)
	ProblemDetail rejected(EnvelopeRejectedException ex) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(ex.reason().status(), ex.getMessage());
		problem.setTitle(ex.reason().title());
		problem.setProperty(REASON, ex.reason().code());
		return problem;
	}

	@ExceptionHandler(ShareNotFoundException.class)
	ProblemDetail notFound(ShareNotFoundException ex) {
		ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.NOT_FOUND, ex.getMessage());
		problem.setTitle("Shared timetable not found");
		problem.setProperty(REASON, "not-found");
		return problem;
	}

}
