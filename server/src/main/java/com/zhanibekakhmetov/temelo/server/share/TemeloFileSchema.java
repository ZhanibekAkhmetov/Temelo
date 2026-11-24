package com.zhanibekakhmetov.temelo.server.share;

import java.util.Map;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * The {@code .temelo} file as the OpenAPI description shows it. Documentation
 * only: the server never binds a request to this type — it reads the raw text
 * and checks it with {@link TemeloEnvelopeValidator}.
 */
@Schema(name = "TemeloTimetableFile",
		description = "A .temelo file: a versioned envelope around a timetable snapshot. The server checks the "
				+ "envelope; the snapshot is validated in full by the app that imports it.")
record TemeloFileSchema(
		@Schema(description = "Identifies the document as a Temelo timetable.",
				allowableValues = TemeloEnvelopeValidator.FILE_TYPE,
				requiredMode = Schema.RequiredMode.REQUIRED) String type,
		@Schema(description = "The envelope's own version.", minimum = "1", maximum = "1",
				requiredMode = Schema.RequiredMode.REQUIRED) int formatVersion,
		@Schema(description = "When the app wrote the file. Informational.",
				format = "date-time") String exportedAt,
		@Schema(description = "The timetable snapshot: formatVersion, timetable, settings, and the timeSlots, "
				+ "courses, placements and exceptions arrays (at most 20,000 records together).",
				requiredMode = Schema.RequiredMode.REQUIRED) Map<String, Object> timetable) {
}
