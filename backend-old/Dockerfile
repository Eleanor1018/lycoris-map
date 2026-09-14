FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /app

COPY pom.xml .
COPY src ./src

RUN mvn -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app

RUN addgroup --system lycoris && adduser --system --ingroup lycoris lycoris

COPY --from=build /app/target/*.jar /app/app.jar
RUN mkdir -p /app/uploads && chown -R lycoris:lycoris /app

USER lycoris

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
