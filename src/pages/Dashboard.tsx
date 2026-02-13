import { useProfile } from "@/hooks/useProfile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Upload, Brain, Calendar, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";

const Dashboard = () => {
  const { profile } = useProfile();
  const navigate = useNavigate();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome{profile?.name ? `, ${profile.name}` : ""}
        </h1>
        <p className="text-muted-foreground mt-1">
          Your AI-powered endurance training dashboard
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/upload")}>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Upload className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Import Data</CardTitle>
              <CardDescription>Upload FIT or CSV files</CardDescription>
            </div>
          </CardHeader>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/analysis")}>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Brain className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">AI Analysis</CardTitle>
              <CardDescription>Get training insights</CardDescription>
            </div>
          </CardHeader>
        </Card>

        <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => navigate("/training-plan")}>
          <CardHeader className="flex flex-row items-center gap-4 pb-2">
            <div className="rounded-lg bg-primary/10 p-2.5">
              <Calendar className="w-5 h-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">Training Plan</CardTitle>
              <CardDescription>Generate your plan</CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Placeholder for future KPI charts */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Training Overview
          </CardTitle>
          <CardDescription>
            Import your Garmin data to see training load, recovery metrics, and performance trends here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Upload className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-lg font-medium">No data yet</p>
            <p className="text-sm">Upload your first FIT or CSV file to get started</p>
            <Button className="mt-4" onClick={() => navigate("/upload")}>
              Import Data
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Dashboard;
