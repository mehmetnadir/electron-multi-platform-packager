package com.getcapacitor;
/** JVM test saplaması — yalnız sabit ve Builder.setRouteProcessor. */
public class Bridge {
    public static final String CAPACITOR_FILE_START = "/_capacitor_file_";
    public static class Builder {
        public RouteProcessor rp;
        public Builder setRouteProcessor(RouteProcessor r) { rp = r; return this; }
    }
}
