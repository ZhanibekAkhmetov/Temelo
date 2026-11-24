package com.zhanibekakhmetov.temelo.server.health;

/**
 * The body of {@code GET /api/health}.
 *
 * @param status the server as a whole: {@code UP} only when everything it
 * depends on is
 * @param database whether the PostgreSQL database answers
 */
record HealthResponse(Status status, Status database) {

	enum Status {

		UP, DOWN

	}

}
