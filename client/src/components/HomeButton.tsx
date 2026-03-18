import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function HomeButton() {
  const navigate = useNavigate();

  return (
    <motion.button
      onClick={() => navigate('/')}
      className="group flex items-center gap-2 text-gray-400 hover:text-gold transition-colors duration-200"
      whileHover={{ x: -2 }}
      whileTap={{ scale: 0.95 }}
    >
      <svg className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      <span className="text-sm font-medium">Home</span>
    </motion.button>
  );
}
