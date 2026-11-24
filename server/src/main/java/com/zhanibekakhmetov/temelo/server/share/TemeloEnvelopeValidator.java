package com.zhanibekakhmetov.temelo.server.share;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;

import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import com.zhanibekakhmetov.temelo.server.share.EnvelopeRejectedException.Reason;

/**
 * Decides whether an upload is a {@code .temelo} file worth storing.
 *
 * <p>The checks follow the app's own {@code parseTemeloFile}
 * ({@code src/storage/timetableFile.ts}) through its first four steps — it is
 * JSON, it is an object, it carries the {@code temelo-timetable} type, its
 * envelope version is one this server knows, and it does not describe more
 * records than the app would ever import — and then stop. The fifth step, the
 * snapshot validator that rebuilds every record, deliberately stays in the app
 * alone: a second copy in Java would be a second definition of what a
 * timetable is, and the app re-validates whatever it downloads anyway, because
 * the server is never trusted. What this does is keep the server from becoming
 * storage for arbitrary data.
 *
 * <p>So a newer <em>snapshot</em> version inside a known envelope is accepted:
 * the app that opens the link is the one that knows whether it can read it.
 */
@Component
class TemeloEnvelopeValidator {

	/** The magic, as {@code TEMELO_FILE_TYPE} in the app. */
	static final String FILE_TYPE = "temelo-timetable";

	/** The newest envelope version the server stores, as {@code TEMELO_FILE_FORMAT_VERSION}. */
	static final int SUPPORTED_FORMAT_VERSION = 1;

	/** The most records a file may describe, as {@code MAX_TEMELO_FILE_RECORDS}. */
	static final int MAX_RECORDS = 20_000;

	/**
	 * Every field an envelope may have. Anything else is refused, so nothing can
	 * be stored alongside a timetable — the app's envelope is not allowed to grow
	 * a second payload either.
	 */
	private static final Set<String> ENVELOPE_FIELDS = Set.of("type", "formatVersion", "exportedAt", "timetable");

	/** The snapshot's record collections, as counted by {@code claimedRecordCount}. */
	private static final List<String> RECORD_COLLECTIONS = List.of("timeSlots", "courses", "placements",
			"exceptions");

	private final JsonMapper mapper = JsonMapper.builder()
		.enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
		.enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
		.build();

	/**
	 * Checks an upload and returns its text, which is exactly what was checked.
	 *
	 * <p>The bytes are decoded as strict UTF-8 first and the JSON is parsed from
	 * that text, not from the bytes: Jackson would otherwise detect UTF-16 or
	 * UTF-32 on its own and accept a body that the stored text — and the app's
	 * {@code JSON.parse} — would read as something else.
	 * @param body the request body, already bounded by the controller
	 * @return the body as text
	 * @throws EnvelopeRejectedException if it is not a storable Temelo file
	 */
	String check(byte[] body) {
		String text = decodeUtf8(body);
		JsonNode root = parse(text);

		JsonNode type = root.get("type");
		if (type == null || !type.isString() || !FILE_TYPE.equals(type.asString())) {
			throw new EnvelopeRejectedException(Reason.NOT_TEMELO, "The body's type is not \"" + FILE_TYPE + "\".");
		}

		JsonNode formatVersion = root.get("formatVersion");
		if (!isPositiveInt(formatVersion)) {
			throw new EnvelopeRejectedException(Reason.MALFORMED, "formatVersion must be a positive integer.");
		}
		if (formatVersion.intValue() > SUPPORTED_FORMAT_VERSION) {
			throw new EnvelopeRejectedException(Reason.UNSUPPORTED_VERSION, "File format " + formatVersion.intValue()
					+ " is newer than " + SUPPORTED_FORMAT_VERSION + ", the newest this server stores.");
		}

		for (Map.Entry<String, JsonNode> field : root.properties()) {
			if (!ENVELOPE_FIELDS.contains(field.getKey())) {
				throw new EnvelopeRejectedException(Reason.MALFORMED,
						"Unexpected field \"" + field.getKey() + "\" in the envelope.");
			}
		}

		JsonNode exportedAt = root.get("exportedAt");
		if (exportedAt != null && !exportedAt.isString()) {
			throw new EnvelopeRejectedException(Reason.MALFORMED, "exportedAt must be a string.");
		}

		checkSnapshotShape(root.get("timetable"));
		return text;
	}

	private void checkSnapshotShape(JsonNode snapshot) {
		if (snapshot == null || !snapshot.isObject()) {
			throw new EnvelopeRejectedException(Reason.MALFORMED, "The file holds no timetable object.");
		}
		if (!isPositiveInt(snapshot.get("formatVersion"))) {
			throw new EnvelopeRejectedException(Reason.MALFORMED,
					"timetable.formatVersion must be a positive integer.");
		}
		for (String field : List.of("timetable", "settings")) {
			JsonNode value = snapshot.get(field);
			if (value == null || !value.isObject()) {
				throw new EnvelopeRejectedException(Reason.MALFORMED, "timetable." + field + " must be an object.");
			}
		}
		long records = 0;
		for (String collection : RECORD_COLLECTIONS) {
			JsonNode value = snapshot.get(collection);
			if (value == null || !value.isArray()) {
				throw new EnvelopeRejectedException(Reason.MALFORMED, "timetable." + collection + " must be an array.");
			}
			records += value.size();
		}
		if (records > MAX_RECORDS) {
			throw new EnvelopeRejectedException(Reason.TOO_LARGE,
					"The timetable has " + records + " records; at most " + MAX_RECORDS + " are accepted.");
		}
	}

	private JsonNode parse(String text) {
		JsonNode root;
		try {
			root = this.mapper.readTree(text);
		}
		catch (JacksonException ex) {
			throw new EnvelopeRejectedException(Reason.NOT_TEMELO, "The body is not valid JSON.");
		}
		if (root == null || !root.isObject()) {
			throw new EnvelopeRejectedException(Reason.NOT_TEMELO, "The body is not a JSON object.");
		}
		return root;
	}

	private static String decodeUtf8(byte[] body) {
		try {
			return StandardCharsets.UTF_8.newDecoder()
				.onMalformedInput(CodingErrorAction.REPORT)
				.onUnmappableCharacter(CodingErrorAction.REPORT)
				.decode(ByteBuffer.wrap(body))
				.toString();
		}
		catch (CharacterCodingException ex) {
			throw new EnvelopeRejectedException(Reason.NOT_TEMELO, "The body is not UTF-8 text.");
		}
	}

	private static boolean isPositiveInt(JsonNode node) {
		return node != null && node.isIntegralNumber() && node.canConvertToInt() && node.intValue() >= 1;
	}

}
