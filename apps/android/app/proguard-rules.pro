# Library consumer rules are applied by Gradle. App-specific rules live here.

# WorkManager persists worker class names across application updates.
-keepnames class com.lycoris.maps.feature.contributions.ContributionWorker
