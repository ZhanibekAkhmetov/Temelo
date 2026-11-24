package com.zhanibekakhmetov.temelo.server.share;

import java.io.IOException;
import java.net.URI;

import jakarta.servlet.http.HttpServletRequest;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.tags.Tag;

import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Share a timetable as a link: upload a {@code .temelo} file, get an id that
 * fetches it until it expires.
 */
@RestController
@Tag(name = "Share links",
		description = "Share a timetable as a link. Upload a .temelo file and get back an id; anyone with the id "
				+ "can fetch the file until it expires. There are no accounts. The app validates every "
				+ "downloaded file itself, exactly as it validates a file opened from disk.")
class ShareController {

	static final String SHARES_PATH = "/api/shares";

	private final ShareService shares;

	private final ShareProperties properties;

	ShareController(ShareService shares, ShareProperties properties) {
		this.shares = shares;
		this.properties = properties;
	}

	@PostMapping(path = SHARES_PATH, consumes = MediaType.APPLICATION_JSON_VALUE,
			produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "Share a timetable",
			description = "Stores a .temelo file and returns the id that fetches it, with its expiry. The server "
					+ "checks the envelope — the temelo-timetable type, a supported formatVersion, the expected "
					+ "fields, at most 20,000 records and 1 MB — not every record inside it.",
			requestBody = @io.swagger.v3.oas.annotations.parameters.RequestBody(required = true,
					description = "A .temelo file, as the app exports it.",
					content = @Content(mediaType = MediaType.APPLICATION_JSON_VALUE,
							schema = @Schema(implementation = TemeloFileSchema.class))),
			responses = {
					@ApiResponse(responseCode = "201", description = "Stored. Location points at the share.",
							content = @Content(schema = @Schema(implementation = ShareCreatedResponse.class))),
					@ApiResponse(responseCode = "413", description = "Over 1 MB, or over 20,000 records "
							+ "(reason: too-large).", content = @Content(mediaType = "application/problem+json",
									schema = @Schema(implementation = ProblemDetail.class))),
					@ApiResponse(responseCode = "415", description = "Not sent as application/json.",
							content = @Content(mediaType = "application/problem+json",
									schema = @Schema(implementation = ProblemDetail.class))),
					@ApiResponse(responseCode = "422", description = "Not a Temelo timetable (reason: not-temelo, "
							+ "unsupported-version or malformed).",
							content = @Content(mediaType = "application/problem+json",
									schema = @Schema(implementation = ProblemDetail.class))) })
	ResponseEntity<ShareCreatedResponse> create(@Parameter(hidden = true) HttpServletRequest request)
			throws IOException {
		byte[] body = BoundedRequestBody.read(request, (int) this.properties.maxSize().toBytes());
		SharedTimetable share = this.shares.create(body);
		// Relative, so it stays right behind a proxy that terminates HTTPS.
		return ResponseEntity.created(URI.create(SHARES_PATH + "/" + share.getId()))
			.cacheControl(CacheControl.noStore())
			.body(new ShareCreatedResponse(share.getId(), share.getExpiresAt()));
	}

	@GetMapping(path = SHARES_PATH + "/{id}", produces = MediaType.APPLICATION_JSON_VALUE)
	@Operation(summary = "Fetch a shared timetable",
			description = "Returns the .temelo file exactly as it was shared. An unknown id and an expired one "
					+ "get the same 404, so the API does not reveal whether an id ever existed.",
			responses = {
					@ApiResponse(responseCode = "200", description = "The shared .temelo file.",
							content = @Content(schema = @Schema(implementation = TemeloFileSchema.class))),
					@ApiResponse(responseCode = "404", description = "No such share, or it has expired "
							+ "(reason: not-found).", content = @Content(mediaType = "application/problem+json",
									schema = @Schema(implementation = ProblemDetail.class))) })
	ResponseEntity<String> get(@Parameter(description = "The id returned when the timetable was shared.",
			example = "o2Gx0b5cQd2u8rT1yKz3Aw") @PathVariable String id) {
		String envelope = this.shares.findEnvelope(id).orElseThrow(ShareNotFoundException::new);
		return ResponseEntity.ok()
			.contentType(MediaType.APPLICATION_JSON)
			.cacheControl(CacheControl.noStore())
			.body(envelope);
	}

}
