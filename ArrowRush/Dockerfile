# Сборка
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY ArrowRush.csproj ./
RUN dotnet restore
COPY . ./
RUN dotnet publish ArrowRush.csproj -c Release -o /app --no-restore

# Запуск
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app ./
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080
ENTRYPOINT ["dotnet", "ArrowRush.dll"]
