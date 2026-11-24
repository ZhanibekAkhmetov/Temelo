package com.zhanibekakhmetov.temelo.server.share;

import java.time.Instant;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * The answer to sharing a timetable.
 *
 * @param id fetches the file at {@code GET /api/shares/{id}}
 * @param expiresAt when the link stops working
 */
@Schema(name = "ShareCreated")
record ShareCreatedResponse(
		@Schema(description = "Fetches the file at GET /api/shares/{id}.", example = "o2Gx0b5cQd2u8rT1yKz3Aw",
				requiredMode = Schema.RequiredMode.REQUIRED) String id,
		@Schema(description = "When the link stops working.", example = "2026-12-08T09:00:00.000Z",
				requiredMode = Schema.RequiredMode.REQUIRED) Instant expiresAt) {
}
