package com.routecatch.api.exception;

import java.time.Instant;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

import com.routecatch.api.dto.ApiErrorResponse;

import jakarta.servlet.http.HttpServletRequest;

@RestControllerAdvice
public class GlobalExceptionHandler {

	@ExceptionHandler(RoutingEngineException.class)
	public ResponseEntity<ApiErrorResponse> handleRoutingEngineException(
		RoutingEngineException exception,
		HttpServletRequest request
	) {
		return errorResponse(
			HttpStatus.BAD_GATEWAY,
			exception.getErrorCode(),
			exception.getMessage(),
			request
		);
	}

	@ExceptionHandler(MethodArgumentNotValidException.class)
	public ResponseEntity<ApiErrorResponse> handleValidationException(
		MethodArgumentNotValidException exception,
		HttpServletRequest request
	) {
		FieldError fieldError = exception.getBindingResult().getFieldError();
		String message = fieldError == null
			? "Request validation failed"
			: "%s %s".formatted(fieldError.getField(), fieldError.getDefaultMessage());

		return errorResponse(
			HttpStatus.BAD_REQUEST,
			"VALIDATION_ERROR",
			message,
			request
		);
	}

	@ExceptionHandler(HttpMessageNotReadableException.class)
	public ResponseEntity<ApiErrorResponse> handleMalformedRequest(
		HttpMessageNotReadableException exception,
		HttpServletRequest request
	) {
		return errorResponse(
			HttpStatus.BAD_REQUEST,
			"MALFORMED_JSON",
			"Request body is malformed",
			request
		);
	}

	@ExceptionHandler(Exception.class)
	public ResponseEntity<ApiErrorResponse> handleUnexpectedException(
		Exception exception,
		HttpServletRequest request
	) {
		return errorResponse(
			HttpStatus.INTERNAL_SERVER_ERROR,
			"INTERNAL_SERVER_ERROR",
			"An unexpected error occurred",
			request
		);
	}

	private ResponseEntity<ApiErrorResponse> errorResponse(
		HttpStatus status,
		String errorCode,
		String message,
		HttpServletRequest request
	) {
		ApiErrorResponse response = new ApiErrorResponse(
			errorCode,
			message,
			request.getRequestURI(),
			Instant.now()
		);

		return ResponseEntity.status(status).body(response);
	}
}
