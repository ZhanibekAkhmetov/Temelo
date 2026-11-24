package com.zhanibekakhmetov.temelo.server.share;

import java.time.Instant;
import java.util.Optional;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface SharedTimetableRepository extends JpaRepository<SharedTimetable, String> {

	/** The share with this id, if it has not expired by {@code now}. */
	Optional<SharedTimetable> findByIdAndExpiresAtAfter(String id, Instant now);

	/** Deletes every share that has expired by {@code now}; returns how many. */
	@Modifying
	@Query("delete from SharedTimetable s where s.expiresAt <= :now")
	int deleteExpired(@Param("now") Instant now);

}
