package com.zhanibekakhmetov.temelo.server.share;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.JsonNodeFactory;

import com.zhanibekakhmetov.temelo.server.share.EnvelopeRejectedException.Reason;

/**
 * What the server is willing to store, checked without Spring: the envelope
 * rules the app's {@code parseTemeloFile} applies before it validates the
 * snapshot, and nothing beyond them.
 */
class TemeloEnvelopeValidatorTests {

	private final TemeloEnvelopeValidator validator = new TemeloEnvelopeValidator();

	@Test
	void acceptsAFileTheAppExported() {
		assertThat(this.validator.check(ExampleTimetable.bytes())).isEqualTo(ExampleTimetable.text());
	}

	@Test
	void returnsTheTextExactlyAsUploaded() {
		String spaced = "  " + ExampleTimetable.text().replace(",", ", ") + "\n";
		assertThat(this.validator.check(spaced.getBytes(StandardCharsets.UTF_8))).isEqualTo(spaced);
	}

	@Test
	void keepsNonAsciiTextIntact() {
		byte[] body = ExampleTimetable.edited((root) -> ((tools.jackson.databind.node.ObjectNode) ExampleTimetable
			.snapshot(root)
			.get("timetable")).put("name", "Übungen – Analysis 🧮"));
		assertThat(this.validator.check(body)).contains("Übungen – Analysis 🧮");
	}

	@Test
	void refusesSomethingThatIsNotJson() {
		assertRejected("this is a photo".getBytes(StandardCharsets.UTF_8), Reason.NOT_TEMELO);
		assertRejected(new byte[0], Reason.NOT_TEMELO);
	}

	@Test
	void refusesJsonThatIsNotAnObject() {
		assertRejected("[1, 2, 3]".getBytes(StandardCharsets.UTF_8), Reason.NOT_TEMELO);
		assertRejected("\"temelo-timetable\"".getBytes(StandardCharsets.UTF_8), Reason.NOT_TEMELO);
	}

	@Test
	void refusesTrailingContentAfterTheObject() {
		assertRejected((ExampleTimetable.text() + " {}").getBytes(StandardCharsets.UTF_8), Reason.NOT_TEMELO);
	}

	@Test
	void refusesDuplicateKeys() {
		String duplicated = ExampleTimetable.text().replaceFirst("\\{", "{\"type\":\"temelo-timetable\",");
		assertRejected(duplicated.getBytes(StandardCharsets.UTF_8), Reason.NOT_TEMELO);
	}

	@Test
	void refusesBytesThatAreNotUtf8() {
		assertRejected(new byte[] { '{', (byte) 0xC3, '}' }, Reason.NOT_TEMELO);
		// Valid JSON in UTF-16, which Jackson alone would detect and accept.
		assertRejected(ExampleTimetable.text().getBytes(StandardCharsets.UTF_16), Reason.NOT_TEMELO);
	}

	@Test
	void refusesAnObjectWithoutTheTemeloType() {
		assertRejected(ExampleTimetable.edited((root) -> root.remove("type")), Reason.NOT_TEMELO);
		assertRejected(ExampleTimetable.edited((root) -> root.put("type", "something-else")), Reason.NOT_TEMELO);
		assertRejected(ExampleTimetable.edited((root) -> root.put("type", 1)), Reason.NOT_TEMELO);
	}

	@Test
	void refusesAMissingOrInvalidEnvelopeVersion() {
		assertRejected(ExampleTimetable.edited((root) -> root.remove("formatVersion")), Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> root.put("formatVersion", "1")), Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> root.put("formatVersion", 0)), Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> root.put("formatVersion", 1.5)), Reason.MALFORMED);
	}

	@Test
	void refusesANewerEnvelopeVersion() {
		assertRejected(ExampleTimetable.edited((root) -> root.put("formatVersion", 2)), Reason.UNSUPPORTED_VERSION);
	}

	@Test
	void acceptsANewerSnapshotVersionForTheAppToJudge() {
		byte[] body = ExampleTimetable.edited((root) -> ExampleTimetable.snapshot(root).put("formatVersion", 99));
		assertThat(this.validator.check(body)).contains("\"formatVersion\":99");
	}

	@Test
	void refusesExtraFieldsBesideTheTimetable() {
		assertRejected(ExampleTimetable.edited((root) -> root.put("payload", "anything at all")), Reason.MALFORMED);
	}

	@Test
	void refusesANonStringExportDate() {
		assertRejected(ExampleTimetable.edited((root) -> root.put("exportedAt", 1_700_000_000)), Reason.MALFORMED);
	}

	@Test
	void acceptsAFileWithoutAnExportDate() {
		byte[] body = ExampleTimetable.edited((root) -> root.remove("exportedAt"));
		assertThat(this.validator.check(body)).doesNotContain("exportedAt");
	}

	@Test
	void refusesAMissingOrMisshapenSnapshot() {
		assertRejected(ExampleTimetable.edited((root) -> root.remove("timetable")), Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> root.put("timetable", "none")), Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> ExampleTimetable.snapshot(root).remove("formatVersion")),
				Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> ExampleTimetable.snapshot(root).remove("settings")),
				Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> ExampleTimetable.snapshot(root).put("placements", "[]")),
				Reason.MALFORMED);
		assertRejected(ExampleTimetable.edited((root) -> ExampleTimetable.snapshot(root).remove("exceptions")),
				Reason.MALFORMED);
	}

	@Test
	void acceptsExactlyTheRecordLimit() {
		byte[] body = withRecords(TemeloEnvelopeValidator.MAX_RECORDS);
		assertThat(this.validator.check(body)).isNotEmpty();
	}

	@Test
	void refusesMoreRecordsThanTheAppWouldImport() {
		assertRejected(withRecords(TemeloEnvelopeValidator.MAX_RECORDS + 1), Reason.TOO_LARGE);
	}

	/** The example with its four collections holding {@code total} records between them. */
	private static byte[] withRecords(int total) {
		return ExampleTimetable.edited((root) -> {
			var snapshot = ExampleTimetable.snapshot(root);
			int perCollection = total / 4;
			String[] collections = { "timeSlots", "courses", "placements", "exceptions" };
			for (int i = 0; i < collections.length; i++) {
				int count = (i == collections.length - 1) ? total - perCollection * 3 : perCollection;
				ArrayNode array = JsonNodeFactory.instance.arrayNode();
				for (int n = 0; n < count; n++) {
					array.addObject();
				}
				snapshot.set(collections[i], array);
			}
		});
	}

	private void assertRejected(byte[] body, Reason reason) {
		assertThatThrownBy(() -> this.validator.check(body)).isInstanceOfSatisfying(EnvelopeRejectedException.class,
				(ex) -> assertThat(ex.reason()).isEqualTo(reason));
	}

}
