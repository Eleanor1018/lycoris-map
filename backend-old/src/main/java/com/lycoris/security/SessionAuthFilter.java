package com.lycoris.security;

import com.lycoris.entity.User;
import com.lycoris.service.UserService;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Objects;

public class SessionAuthFilter extends OncePerRequestFilter {
    private final UserService userService;

    public SessionAuthFilter(UserService userService) {
        this.userService = userService;
    }
    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        // Revalidate each request, even if Spring restored an older authentication.
        SecurityContextHolder.clearContext();
        HttpSession session = request.getSession(false);
        if (session != null && session.getAttribute("userId") != null) {
            Integer userId = parseUserId(session.getAttribute("userId"));
            User user = userId == null ? null : userService.findById(userId).orElse(null);
            Object version = session.getAttribute("sessionVersion");
            if (user == null || Boolean.TRUE.equals(user.getDeleted())
                    || !(version instanceof Number number)
                    || !Objects.equals(number.longValue(), user.getSessionVersion())) {
                session.invalidate();
            } else {
                if (!Objects.equals(session.getAttribute("role"), user.getRole())) {
                    session.removeAttribute("adminSecondVerified");
                    session.removeAttribute("adminSecondVerifiedAt");
                }
                session.setAttribute("username", user.getUsername());
                session.setAttribute("role", user.getRole());
                var authorities = new ArrayList<SimpleGrantedAuthority>();
                authorities.add(new SimpleGrantedAuthority("ROLE_USER"));
                if ("ADMIN".equalsIgnoreCase(user.getRole())) {
                    authorities.add(new SimpleGrantedAuthority("ROLE_ADMIN"));
                }
                var auth = new UsernamePasswordAuthenticationToken(user.getUsername(), null, authorities);
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                SecurityContextHolder.getContext().setAuthentication(auth);
            }
        }

        filterChain.doFilter(request, response);
    }

    private Integer parseUserId(Object value) {
        try {
            return Integer.valueOf(String.valueOf(value));
        } catch (NumberFormatException ignored) {
            return null;
        }
    }
}
