package com.zhanibekakhmetov.temelo.server.share;

/** No share with the requested id, or it has expired — deliberately the same thing. */
class ShareNotFoundException extends RuntimeException {

	ShareNotFoundException() {
		super("No shared timetable has this id, or its link has expired.");
	}

}
