package com.zhanibekakhmetov.temelo.server.share;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.BDDMockito.given;
import static org.mockito.BDDMockito.then;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;

import java.io.ByteArrayInputStream;
import java.io.IOException;

import jakarta.servlet.http.HttpServletRequest;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.DelegatingServletInputStream;

import com.zhanibekakhmetov.temelo.server.share.EnvelopeRejectedException.Reason;

/**
 * The size limit on both of its paths: a declared Content-Length, and a
 * chunked upload that declares none — the one MockMvc cannot send, since it
 * always sets the header.
 */
class BoundedRequestBodyTests {

	private static final int LIMIT = 100;

	@Test
	void readsABodyAtTheLimit() throws IOException {
		assertThat(BoundedRequestBody.read(chunked(LIMIT), LIMIT)).hasSize(LIMIT);
	}

	@Test
	void refusesAChunkedBodyOneByteOverTheLimit() {
		assertTooLarge(chunked(LIMIT + 1));
	}

	@Test
	void refusesAChunkedBodyFarOverTheLimit() {
		assertTooLarge(chunked(LIMIT * 1000));
	}

	@Test
	void refusesADeclaredLengthOverTheLimitWithoutReading() throws IOException {
		HttpServletRequest request = mock(HttpServletRequest.class);
		given(request.getContentLengthLong()).willReturn((long) LIMIT + 1);

		assertTooLarge(request);
		then(request).should(never()).getInputStream();
	}

	@Test
	void readsAnEmptyBody() throws IOException {
		assertThat(BoundedRequestBody.read(chunked(0), LIMIT)).isEmpty();
	}

	/** A request with {@code size} bytes of body and no Content-Length. */
	private static HttpServletRequest chunked(int size) {
		HttpServletRequest request = mock(HttpServletRequest.class);
		given(request.getContentLengthLong()).willReturn(-1L);
		try {
			given(request.getInputStream())
				.willReturn(new DelegatingServletInputStream(new ByteArrayInputStream(new byte[size])));
		}
		catch (IOException ex) {
			throw new IllegalStateException(ex);
		}
		return request;
	}

	private static void assertTooLarge(HttpServletRequest request) {
		assertThatThrownBy(() -> BoundedRequestBody.read(request, LIMIT))
			.isInstanceOfSatisfying(EnvelopeRejectedException.class,
					(ex) -> assertThat(ex.reason()).isEqualTo(Reason.TOO_LARGE));
	}

}
