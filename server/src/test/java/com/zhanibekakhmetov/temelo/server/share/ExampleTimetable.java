package com.zhanibekakhmetov.temelo.server.share;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.util.function.Consumer;

import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The real {@code .temelo} file the tests share: written by the app's own
 * export code ({@code buildValidatedTemeloFile}) and accepted by its parser,
 * and the same file Swagger UI offers as its example.
 */
final class ExampleTimetable {

	static final String RESOURCE = "/openapi/example-timetable.temelo";

	private static final JsonMapper MAPPER = JsonMapper.shared();

	private ExampleTimetable() {
	}

	static byte[] bytes() {
		try (InputStream in = ExampleTimetable.class.getResourceAsStream(RESOURCE)) {
			if (in == null) {
				throw new IllegalStateException(RESOURCE + " is missing");
			}
			return in.readAllBytes();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	static String text() {
		return new String(bytes(), StandardCharsets.UTF_8);
	}

	/** The example with {@code edit} applied to its root object, as UTF-8 bytes. */
	static byte[] edited(Consumer<ObjectNode> edit) {
		ObjectNode root = (ObjectNode) MAPPER.readTree(text());
		edit.accept(root);
		return MAPPER.writeValueAsBytes(root);
	}

	/** The snapshot object inside an envelope. */
	static ObjectNode snapshot(ObjectNode root) {
		return (ObjectNode) root.get("timetable");
	}

}
