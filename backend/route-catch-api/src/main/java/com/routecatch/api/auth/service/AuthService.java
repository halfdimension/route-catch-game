package com.routecatch.api.auth.service;

import java.util.UUID;

import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import com.routecatch.api.auth.dto.AuthResponse;
import com.routecatch.api.auth.dto.LoginRequest;
import com.routecatch.api.auth.dto.RegisterRequest;
import com.routecatch.api.auth.dto.UserResponse;
import com.routecatch.api.auth.exception.InvalidCredentialsException;
import com.routecatch.api.auth.exception.UserAlreadyExistsException;
import com.routecatch.api.auth.persistence.UserEntity;
import com.routecatch.api.auth.persistence.UserRepository;

@Service
public class AuthService {

	private final UserRepository userRepository;
	private final PasswordEncoder passwordEncoder;

	public AuthService(
		UserRepository userRepository,
		PasswordEncoder passwordEncoder
	) {
		this.userRepository = userRepository;
		this.passwordEncoder = passwordEncoder;
	}

	@Transactional
	public AuthResponse register(RegisterRequest request) {
		if (userRepository.existsByUsername(request.username())) {
			throw new UserAlreadyExistsException("Username is already registered");
		}

		if (request.email() != null && userRepository.existsByEmail(request.email())) {
			throw new UserAlreadyExistsException("Email is already registered");
		}

		UserEntity user = new UserEntity(
			UUID.randomUUID(),
			request.username(),
			request.email(),
			request.displayName(),
			passwordEncoder.encode(request.password())
		);

		return new AuthResponse(UserResponse.from(userRepository.save(user)));
	}

	@Transactional(readOnly = true)
	public AuthResponse login(LoginRequest request) {
		UserEntity user = userRepository.findByUsername(request.usernameOrEmail())
			.or(() -> userRepository.findByEmail(request.usernameOrEmail()))
			.orElseThrow(InvalidCredentialsException::new);

		if (!passwordEncoder.matches(request.password(), user.getPasswordHash())) {
			throw new InvalidCredentialsException();
		}

		return new AuthResponse(UserResponse.from(user));
	}
}
