import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import coachClaireImg from "@/assets/coach-claire.png";

interface Props {
  className?: string;
  variant?: "default" | "compact";
}

const CoachClaireCard = ({ className = "", variant = "default" }: Props) => (
  <section className={`w-full ${className}`}>
    <Link
      to="/coach/claire-rayners"
      className="group relative block overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card to-card p-5 sm:p-7 shadow-sm hover:shadow-lg transition-all"
    >
      <div className="absolute -top-10 -right-10 h-40 w-40 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
      <div className="relative flex items-start gap-4 sm:gap-5">
        <img
          src={coachClaireImg}
          alt="Coach Claire Rayners"
          loading="lazy"
          width={768}
          height={768}
          className="shrink-0 h-16 w-16 sm:h-20 sm:w-20 rounded-full object-cover border-2 border-primary/40 shadow-md"
        />
        <div className="flex-1 min-w-0">
          <p className="text-[10px] sm:text-xs font-semibold tracking-widest uppercase text-primary mb-1">
            Meet your coach
          </p>
          <h3
            className="text-xl sm:text-2xl font-bold tracking-tight text-foreground"
            style={{ fontFamily: "'Bebas Neue', sans-serif" }}
          >
            Coach Claire Rayners
          </h3>
          {variant === "default" && (
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              The programmable, system-built elite running coach behind every Scarpers plan, day-ahead briefing
              and post-run review.
            </p>
          )}
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-primary mt-3 group-hover:gap-2 transition-all">
            Read her bio <ArrowRight className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  </section>
);

export default CoachClaireCard;
